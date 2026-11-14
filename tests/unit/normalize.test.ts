import { describe, expect, it } from 'vitest';
import { BadResponseError, dedupe, normalizeCommits, normalizeIssues, normalizePulls, normalizeRepo } from '../../src/lib/github/normalize';
import { ghCommit, ghIssue, ghPull, ghRepo } from './helpers';

describe('normalize (valid data)', () => {
  it('drops pull requests from the issues list', () => {
    const out = normalizeIssues([ghIssue(1), ghIssue(2, { pull_request: { url: 'u' } }), ghIssue(3)]);
    expect(out.map((i) => i.number)).toEqual([1, 3]);
    expect(out[0]?.labels).toEqual(['bug', 'raw']);
  });
  it('PR merged: merged_at set and closed -> merged', () => {
    const [p] = normalizePulls([ghPull(2, { state: 'closed', merged_at: '2026-01-03T00:00:00Z' })]);
    expect(p).toMatchObject({ merged: true, state: 'closed', head: 'h', base: 'main', mergedAt: '2026-01-03T00:00:00Z' });
  });
  it('PR closed without merge is not merged', () => {
    const [p] = normalizePulls([ghPull(3, { state: 'closed' })]);
    expect(p).toMatchObject({ merged: false, state: 'closed' });
    expect(p?.mergedAt).toBeUndefined();
  });
  it('open PR is not merged', () => { expect(normalizePulls([ghPull(4)])[0]?.merged).toBe(false); });
  it('explicit merged boolean is accepted when consistent', () => {
    expect(normalizePulls([ghPull(5, { state: 'closed', merged: true, merged_at: '2026-01-03T00:00:00Z' })])[0]?.merged).toBe(true);
  });
  it('null user (deleted account) is allowed and becomes empty author', () => {
    expect(normalizeIssues([ghIssue(1, { user: null })])[0]?.author).toBe('');
  });
  it('commit author falls back to git author name when no GitHub user', () => {
    expect(normalizeCommits([ghCommit('a', { author: null })])[0]?.author).toBe('Me');
  });
  it('dedupe removes an issue sharing a PR number and duplicates', () => {
    const d = dedupe(normalizeIssues([ghIssue(7), ghIssue(8), ghIssue(8)]), normalizePulls([ghPull(7), ghPull(7)]), normalizeCommits([ghCommit('a'), ghCommit('a')]));
    expect(d.issues.map((i) => i.number)).toEqual([8]);
    expect(d.pulls).toHaveLength(1);
    expect(d.commits).toHaveLength(1);
  });
  it('repo normalizes', () => { expect(normalizeRepo(ghRepo())).toMatchObject({ fullName: 'pofuru-web/ai-dev-lab-public', private: false }); });
});

describe('normalize (abnormal data is rejected, never coerced)', () => {
  const rm = (o: Record<string, unknown>, k: string) => { const c = { ...o }; delete c[k]; return c; };
  it.each([
    ['unknown issue state', () => normalizeIssues([ghIssue(1, { state: 'weird' })])],
    ['uppercase state', () => normalizeIssues([ghIssue(1, { state: 'OPEN' })])],
    ['missing state', () => normalizeIssues([rm(ghIssue(1), 'state')])],
    ['closed issue without closed_at', () => normalizeIssues([ghIssue(1, { state: 'closed' })])],
    ['issue number as string', () => normalizeIssues([ghIssue(1, { number: '1' })])],
    ['issue number zero/negative', () => normalizeIssues([ghIssue(0)])],
    ['issue missing title', () => normalizeIssues([rm(ghIssue(1), 'title')])],
    ['issue bad created_at', () => normalizeIssues([ghIssue(1, { created_at: 'yesterday' })])],
    ['issue user missing', () => normalizeIssues([rm(ghIssue(1), 'user')])],
    ['issue labels not array', () => normalizeIssues([ghIssue(1, { labels: 'x' })])],
    ['issue label wrong shape', () => normalizeIssues([ghIssue(1, { labels: [5] })])],
    ['issues not array', () => normalizeIssues({})],
    ['issue item not object', () => normalizeIssues([1])],
    ['unknown PR state', () => normalizePulls([ghPull(1, { state: 'merged' })])],
    ['PR merged_at missing key', () => normalizePulls([rm(ghPull(1), 'merged_at')])],
    ['PR merged_at invalid', () => normalizePulls([ghPull(1, { state: 'closed', merged_at: 'x' })])],
    ['PR merged flag true but merged_at null', () => normalizePulls([ghPull(1, { state: 'closed', merged: true })])],
    ['PR merged flag false but merged_at set', () => normalizePulls([ghPull(1, { state: 'closed', merged: false, merged_at: '2026-01-03T00:00:00Z' })])],
    ['PR merged but still open', () => normalizePulls([ghPull(1, { merged_at: '2026-01-03T00:00:00Z' })])],
    ['PR missing head', () => normalizePulls([rm(ghPull(1), 'head')])],
    ['PR missing base.ref', () => normalizePulls([ghPull(1, { base: {} })])],
    ['PR missing number', () => normalizePulls([rm(ghPull(1), 'number')])],
    ['commit sha too short', () => normalizeCommits([ghCommit('a', { sha: 'abc' })])],
    ['commit missing commit object', () => normalizeCommits([rm(ghCommit(), 'commit')])],
    ['commit missing message', () => normalizeCommits([ghCommit('a', { commit: { author: { name: 'x' }, committer: { date: '2026-01-01T00:00:00Z' } } })])],
    ['commit bad date', () => normalizeCommits([ghCommit('a', { commit: { message: 'm', author: { name: 'x' }, committer: { date: 'bad' } } })])],
    ['commit no author at all', () => normalizeCommits([ghCommit('a', { author: null, commit: { message: 'm', committer: { date: '2026-01-01T00:00:00Z' } } })])],
    ['repo empty object', () => normalizeRepo({})],
    ['repo private not boolean', () => normalizeRepo(ghRepo({ private: 'no' }))],
    ['repo missing default_branch', () => normalizeRepo(rm(ghRepo(), 'default_branch'))],
    ['repo not object', () => normalizeRepo(null)],
  ])('%s', (_n, fn) => { expect(fn).toThrow(BadResponseError); });
});
