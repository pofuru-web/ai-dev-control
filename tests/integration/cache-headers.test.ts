import { describe, expect, it, vi } from 'vitest';
import { CDN_CACHE_SECONDS, createHandler } from '../../src/lib/github/handler';
import { ghCommit, ghIssue, ghPull, ghRepo } from '../unit/helpers';

const REPO = 'pofuru-web/ai-dev-lab-public';
const rl = { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '55', 'x-ratelimit-reset': '1800000000' };
const ok = (b: unknown, h: Record<string, string> = rl) => new Response(JSON.stringify(b), { status: 200, headers: h });

function upstream(over: Record<string, () => Response> = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    for (const [k, f] of Object.entries(over)) if (path.endsWith(k)) return f();
    if (path.endsWith('/issues')) return ok([ghIssue(1)]);
    if (path.endsWith('/pulls')) return ok([ghPull(2, { state: 'closed', merged_at: '2026-01-03T00:00:00Z' })]);
    if (path.endsWith('/commits')) return ok([ghCommit('a')]);
    return ok(ghRepo());
  }) as unknown as typeof fetch;
}
const call = (h: ReturnType<typeof createHandler>, qs = `repo=${REPO}`, method = 'GET') => h(new Request(`https://x.test/api/github-snapshot?${qs}`, { method }));
const hang = ((_u: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;

describe('CDN cache headers: only successful syncs are cacheable', () => {
  it('a successful response is CDN-cacheable for 60 s, browsers must revalidate, the key varies on repo only', async () => {
    const res = await call(createHandler({}, upstream()));
    expect(res.status).toBe(200);
    expect(CDN_CACHE_SECONDS).toBe(60);
    expect(res.headers.get('netlify-cdn-cache-control')).toBe('public, max-age=60');
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(res.headers.get('netlify-vary')).toBe('query=repo');
    expect(res.headers.get('content-type')).toBe('application/json');
  });

  it('the body format is unchanged: { ok, snapshot } with the same fields as before', async () => {
    const b = await (await call(createHandler({}, upstream()))).json();
    expect(Object.keys(b).sort()).toEqual(['ok', 'snapshot']);
    expect(b.ok).toBe(true);
    expect(Object.keys(b.snapshot).sort()).toEqual(['commits', 'fetchedAt', 'info', 'issues', 'pulls', 'rateLimit', 'repo']);
    expect(b.snapshot.pulls[0]).toMatchObject({ number: 2, merged: true });
  });

  const errorCases: [string, () => Promise<Response>, number][] = [
    ['invalid repo name', () => call(createHandler({}, upstream()), 'repo=../etc'), 400],
    ['missing repo', () => call(createHandler({}, upstream()), ''), 400],
    ['repository outside the allow-list', () => call(createHandler({}, upstream()), 'repo=other/repo'), 403],
    ['private repository', () => call(createHandler({}, upstream({ [`/${REPO.split('/')[1]}`]: () => ok(ghRepo({ private: true })) }))), 403],
    ['not found upstream', () => call(createHandler({}, upstream({ '/pulls': () => new Response('{}', { status: 404 }) }))), 404],
    ['rate limited upstream', () => call(createHandler({}, upstream({ '/issues': () => new Response('{}', { status: 403, headers: { ...rl, 'x-ratelimit-remaining': '0' } }) }))), 429],
    ['upstream server error', () => call(createHandler({}, upstream({ '/commits': () => new Response('{}', { status: 500 }) }))), 502],
    ['malformed upstream data', () => call(createHandler({}, upstream({ '/issues': () => ok([ghIssue(1, { state: 'bogus' })]) }))), 502],
    ['upstream timeout', () => call(createHandler({}, hang, { timeoutMs: 30 })), 504],
    ['network failure', () => call(createHandler({}, (async () => { throw new Error('down'); }) as unknown as typeof fetch)), 502],
  ];
  it.each(errorCases)('error is never cached: %s', async (_n, run, status) => {
    const res = await run();
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('netlify-cdn-cache-control')).toBe('no-store');
    expect(res.headers.get('netlify-vary')).toBe('query=repo'); // identical on every response for a URL
    expect((await res.json()).ok).toBe(false);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])('%s is rejected with 405 and is not cacheable, and GitHub is not called', async (m) => {
    const f = upstream();
    const res = await call(createHandler({}, f), `repo=${REPO}`, m);
    expect(res.status).toBe(405);
    expect(res.headers.get('netlify-cdn-cache-control')).toBe('no-store');
    expect(f).not.toHaveBeenCalled();
  });

  it('allow-list and input checks still run before any GitHub call (cacheable responses come only after them)', async () => {
    const f = upstream();
    const h = createHandler({}, f);
    for (const q of ['repo=other/repo', 'repo=a/../b', 'repo=%2e%2e/x', `repo=${REPO}%0A`]) expect((await call(h, q)).status).toBeGreaterThanOrEqual(400);
    expect(f).not.toHaveBeenCalled();
  });

  it('different repositories produce separate, correctly labelled responses (no mixing at the origin)', async () => {
    const f = ((async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      const repo = u.pathname.split('/').slice(2, 4).join('/');
      if (u.pathname.endsWith('/issues')) return ok([ghIssue(1, { title: `issue of ${repo}` })]);
      if (u.pathname.endsWith('/pulls') || u.pathname.endsWith('/commits')) return ok([]);
      return ok(ghRepo({ full_name: repo }));
    }) as unknown as typeof fetch);
    const h = createHandler({ ALLOWED_REPOS: 'o/a,o/b' }, f);
    const a = await (await call(h, 'repo=o/a')).json();
    const b = await (await call(h, 'repo=o/b')).json();
    expect(a.snapshot.repo).toBe('o/a'); expect(a.snapshot.issues[0].title).toBe('issue of o/a');
    expect(b.snapshot.repo).toBe('o/b'); expect(b.snapshot.issues[0].title).toBe('issue of o/b');
  });

  it('the token is not part of any response or header', async () => {
    const res = await call(createHandler({ GITHUB_TOKEN: 'SECRET123' }, upstream()));
    expect(await res.text()).not.toContain('SECRET123');
    expect([...res.headers.values()].join('|')).not.toContain('SECRET123');
  });
});
