import { describe, expect, it } from 'vitest';
import { BadResponseError, dedupe, normalizeCommits, normalizeIssues, normalizePulls, normalizeRepo } from '../../src/lib/github/normalize';

const issue = (n: number, extra = {}) => ({ number: n, title: `i${n}`, state: 'open', user: { login: 'u' }, created_at: '2026-01-01T00:00:00Z', html_url: 'x', labels: [{ name: 'bug' }, 'raw'], ...extra });

describe('normalize', () => {
  it('drops pull requests from the issues list', () => {
    const out = normalizeIssues([issue(1), issue(2, { pull_request: { url: 'u' } }), issue(3)]);
    expect(out.map((i) => i.number)).toEqual([1, 3]);
    expect(out[0]?.labels).toEqual(['bug', 'raw']);
  });
  it('PR merged: merged_at set -> merged', () => {
    const [p] = normalizePulls([{ number: 2, state: 'closed', merged_at: '2026-01-02T00:00:00Z', user: { login: 'u' }, head: { ref: 'h' }, base: { ref: 'main' } }]);
    expect(p).toMatchObject({ merged: true, state: 'closed', head: 'h', base: 'main' });
  });
  it('PR closed without merge is not merged', () => {
    const [p] = normalizePulls([{ number: 3, state: 'closed', merged_at: null }]);
    expect(p).toMatchObject({ merged: false, state: 'closed' });
    expect(p?.mergedAt).toBeUndefined();
  });
  it('open PR is not merged', () => {
    expect(normalizePulls([{ number: 4, state: 'open', merged_at: null }])[0]?.merged).toBe(false);
  });
  it('explicit merged boolean wins', () => {
    expect(normalizePulls([{ number: 5, state: 'closed', merged: true, merged_at: null }])[0]?.merged).toBe(true);
  });
  it('dedupe removes an issue sharing a PR number and duplicates', () => {
    const issues = normalizeIssues([issue(7), issue(8), issue(8)]);
    const pulls = normalizePulls([{ number: 7, state: 'open' }, { number: 7, state: 'open' }]);
    const commits = normalizeCommits([{ sha: 'a', commit: {} }, { sha: 'a', commit: {} }]);
    const d = dedupe(issues, pulls, commits);
    expect(d.issues.map((i) => i.number)).toEqual([8]);
    expect(d.pulls).toHaveLength(1);
    expect(d.commits).toHaveLength(1);
  });
  it('commits normalize', () => {
    const [c] = normalizeCommits([{ sha: 'abc', html_url: 'u', author: { login: 'me' }, commit: { message: 'm', committer: { date: '2026-01-01T00:00:00Z' } } }]);
    expect(c).toMatchObject({ sha: 'abc', message: 'm', author: 'me', committedAt: '2026-01-01T00:00:00Z' });
  });
  it('rejects wrong shapes', () => {
    expect(() => normalizeIssues({})).toThrow(BadResponseError);
    expect(() => normalizePulls([{ title: 'no number' }])).toThrow(BadResponseError);
    expect(() => normalizeCommits([{}])).toThrow(BadResponseError);
    expect(() => normalizeRepo({})).toThrow(BadResponseError);
  });
});
