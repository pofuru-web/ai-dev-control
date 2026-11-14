import { describe, expect, it, vi } from 'vitest';
import { createHandler } from '../../src/lib/github/handler';
import { refreshSnapshot } from '../../src/lib/github/client';
import { loadSnapshot, saveSnapshot } from '../../src/lib/storage';
import { MemKV } from '../unit/helpers';

const REPO = 'pofuru-web/ai-dev-lab-public';
const rlHeaders = { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '55', 'x-ratelimit-reset': '1800000000' };
const ok = (body: unknown, h: Record<string, string> = rlHeaders) => new Response(JSON.stringify(body), { status: 200, headers: h });

function upstream(overrides: Record<string, () => Response> = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    expect(init?.method).toBe('GET');
    const path = new URL(url).pathname;
    for (const [k, f] of Object.entries(overrides)) if (path.endsWith(k)) return f();
    if (path.endsWith('/issues')) return ok([
      { number: 1, title: 'issue', state: 'open', user: { login: 'o' }, created_at: '2026-01-01T00:00:00Z', html_url: 'u', labels: [] },
      { number: 2, title: 'pr as issue', state: 'closed', pull_request: {}, user: { login: 'o' }, created_at: '2026-01-02T00:00:00Z', html_url: 'u', labels: [] },
    ]);
    if (path.endsWith('/pulls')) return ok([{ number: 2, title: 'pr', state: 'closed', merged_at: '2026-01-03T00:00:00Z', user: { login: 'o' }, head: { ref: 'h' }, base: { ref: 'main' }, created_at: '2026-01-02T00:00:00Z', html_url: 'u' }]);
    if (path.endsWith('/commits')) return ok([{ sha: 's1', html_url: 'u', commit: { message: 'm', committer: { date: '2026-01-01T00:00:00Z' } }, author: { login: 'o' } }]);
    return ok({ full_name: REPO, private: false, default_branch: 'main', html_url: 'u' });
  }) as unknown as typeof fetch;
}

const call = (h: ReturnType<typeof createHandler>, qs = `repo=${REPO}`, method = 'GET') => h(new Request(`https://x.test/api/github-snapshot?${qs}`, { method }));

describe('github-snapshot function (mocked upstream)', () => {
  it('returns normalized, deduped snapshot with rate limit', async () => {
    const f = upstream();
    const res = await call(createHandler({}, f));
    const b = await res.json();
    expect(res.status).toBe(200);
    expect(b.snapshot.issues.map((i: { number: number }) => i.number)).toEqual([1]);
    expect(b.snapshot.pulls[0]).toMatchObject({ number: 2, merged: true });
    expect(b.snapshot.commits).toHaveLength(1);
    expect(b.snapshot.rateLimit).toMatchObject({ limit: 60, remaining: 55 });
    expect(f).toHaveBeenCalledTimes(4);
  });
  it('sends token only to GitHub and never returns it', async () => {
    const f = upstream();
    const res = await call(createHandler({ GITHUB_TOKEN: 'SECRET123' }, f));
    expect(await res.text()).not.toContain('SECRET123');
    const sent = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].headers.Authorization;
    expect(sent).toBe('Bearer SECRET123');
  });
  it('omits Authorization without token', async () => {
    const f = upstream();
    await call(createHandler({}, f));
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].headers.Authorization).toBeUndefined();
  });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects %s', async (m) => {
    const f = upstream();
    expect((await call(createHandler({}, f), `repo=${REPO}`, m)).status).toBe(405);
    expect(f).not.toHaveBeenCalled();
  });
  it('rejects repos outside the allow-list and bad names without calling GitHub', async () => {
    const f = upstream();
    const h = createHandler({}, f);
    expect((await call(h, 'repo=other/repo')).status).toBe(403);
    expect((await call(h, 'repo=../etc')).status).toBe(400);
    expect((await call(h, '')).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
  it('allow-list is configurable', async () => {
    const res = await call(createHandler({ ALLOWED_REPOS: 'a/b' }, upstream()), 'repo=a/b');
    expect(res.status).toBe(200);
  });
  it('rate limit -> 429 with reset time', async () => {
    const f = upstream({ '/issues': () => new Response('{}', { status: 403, headers: { ...rlHeaders, 'x-ratelimit-remaining': '0' } }) });
    const res = await call(createHandler({}, f));
    const b = await res.json();
    expect(res.status).toBe(429);
    expect(b.error).toMatchObject({ code: 'rate_limited', resetAt: new Date(1800000000 * 1000).toISOString() });
  });
  it('404, 500, network error, bad JSON, bad shape', async () => {
    expect((await call(createHandler({}, upstream({ '/pulls': () => new Response('{}', { status: 404 }) })))).status).toBe(404);
    expect((await call(createHandler({}, upstream({ '/commits': () => new Response('{}', { status: 500 }) })))).status).toBe(502);
    const net = vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect((await (await call(createHandler({}, net))).json()).error.code).toBe('network');
    expect((await (await call(createHandler({}, upstream({ '/commits': () => new Response('not json', { status: 200 }) })))).json()).error.code).toBe('bad_response');
    expect((await (await call(createHandler({}, upstream({ '/issues': () => ok({}) })))).json()).error.code).toBe('bad_response');
  });
  it('private repositories are refused', async () => {
    const f = upstream({ [`/${REPO.split('/')[1]}`]: () => ok({ full_name: REPO, private: true }) });
    expect((await call(createHandler({}, f))).status).toBe(403);
  });
});

describe('client refresh protects existing data', () => {
  const good = async () => {
    const res = await call(createHandler({}, upstream()));
    return (await res.json()).snapshot;
  };
  const viaHandler = (h: ReturnType<typeof createHandler>) =>
    (async (u: RequestInfo | URL) => h(new Request(new URL(String(u), 'https://x.test')))) as unknown as typeof fetch;

  it('success stores snapshot', async () => {
    const kv = new MemKV();
    const r = await refreshSnapshot(kv, 'p1', REPO, viaHandler(createHandler({}, upstream())));
    expect(r.ok).toBe(true);
    expect(loadSnapshot(kv, 'p1')?.pulls[0]?.merged).toBe(true);
  });
  it('any failed upstream request leaves the old snapshot unchanged', async () => {
    const kv = new MemKV();
    saveSnapshot(kv, 'p1', await good());
    const before = kv.getItem('adc:snapshot:v1:p1');
    for (const failing of ['/issues', '/pulls', '/commits']) {
      const h = createHandler({}, upstream({ [failing]: () => new Response('{}', { status: 500 }) }));
      const r = await refreshSnapshot(kv, 'p1', REPO, viaHandler(h));
      expect(r.ok).toBe(false);
      expect(kv.getItem('adc:snapshot:v1:p1')).toBe(before);
    }
  });
  it('network failure and garbage response keep the old snapshot', async () => {
    const kv = new MemKV();
    saveSnapshot(kv, 'p1', await good());
    const before = kv.getItem('adc:snapshot:v1:p1');
    expect((await refreshSnapshot(kv, 'p1', REPO, (async () => { throw new Error('x'); }) as unknown as typeof fetch)).ok).toBe(false);
    expect((await refreshSnapshot(kv, 'p1', REPO, (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch)).ok).toBe(false);
    expect((await refreshSnapshot(kv, 'p1', REPO, (async () => new Response(JSON.stringify({ ok: true, snapshot: { bad: 1 } }))) as unknown as typeof fetch)).ok).toBe(false);
    expect(kv.getItem('adc:snapshot:v1:p1')).toBe(before);
  });
  it('storage write failure keeps the old snapshot', async () => {
    const kv = new MemKV();
    saveSnapshot(kv, 'p1', await good());
    const before = kv.getItem('adc:snapshot:v1:p1');
    kv.failSet = () => true;
    const r = await refreshSnapshot(kv, 'p1', REPO, viaHandler(createHandler({}, upstream())));
    expect(r.ok).toBe(false);
    expect(kv.getItem('adc:snapshot:v1:p1')).toBe(before);
  });
});
