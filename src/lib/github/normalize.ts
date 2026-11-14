import type { GhCommit, GhIssue, GhPull, GitHubRepoInfo } from '../../types';

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (typeof v === 'object' && v !== null ? (v as Raw) : {});
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const optStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export class BadResponseError extends Error {}

function requireArray(v: unknown, what: string): Raw[] {
  if (!Array.isArray(v)) throw new BadResponseError(`${what}: expected array`);
  return v.map((x, i) => {
    if (typeof x !== 'object' || x === null) throw new BadResponseError(`${what}[${i}]: expected object`);
    return x as Raw;
  });
}

export function normalizeRepo(raw: unknown): GitHubRepoInfo {
  const r = obj(raw);
  if (typeof r.full_name !== 'string' || typeof r.private !== 'boolean') throw new BadResponseError('repo: unexpected shape');
  return { fullName: r.full_name, defaultBranch: str(r.default_branch), private: r.private, htmlUrl: str(r.html_url) };
}

/** GitHub's /issues endpoint also lists pull requests; those items carry a `pull_request` key and are dropped. */
export function normalizeIssues(raw: unknown): GhIssue[] {
  return requireArray(raw, 'issues')
    .filter((i) => i.pull_request === undefined)
    .map((i) => {
      if (typeof i.number !== 'number') throw new BadResponseError('issue: missing number');
      return {
        number: i.number,
        title: str(i.title),
        state: i.state === 'closed' ? 'closed' : 'open',
        author: str(obj(i.user).login),
        createdAt: str(i.created_at),
        closedAt: optStr(i.closed_at),
        url: str(i.html_url),
        labels: (Array.isArray(i.labels) ? i.labels : []).map((l) => (typeof l === 'string' ? l : str(obj(l).name))).filter(Boolean),
      };
    });
}

/**
 * merged: the list endpoint has no reliable `merged` boolean, so merged_at != null is used
 * (a boolean `merged` is honoured when present). closed + merged_at null = closed without merge.
 */
export function normalizePulls(raw: unknown): GhPull[] {
  return requireArray(raw, 'pulls').map((p) => {
    if (typeof p.number !== 'number') throw new BadResponseError('pull: missing number');
    const mergedAt = optStr(p.merged_at);
    const merged = typeof p.merged === 'boolean' ? p.merged : mergedAt !== undefined;
    return {
      number: p.number,
      title: str(p.title),
      state: p.state === 'closed' ? 'closed' : 'open',
      merged,
      mergedAt,
      author: str(obj(p.user).login),
      head: str(obj(p.head).ref),
      base: str(obj(p.base).ref),
      createdAt: str(p.created_at),
      url: str(p.html_url),
    };
  });
}

export function normalizeCommits(raw: unknown): GhCommit[] {
  return requireArray(raw, 'commits').map((c) => {
    if (typeof c.sha !== 'string') throw new BadResponseError('commit: missing sha');
    const commit = obj(c.commit);
    return {
      sha: c.sha,
      message: str(commit.message),
      author: str(obj(c.author).login) || str(obj(commit.author).name),
      committedAt: str(obj(commit.committer).date) || str(obj(commit.author).date),
      url: str(c.html_url),
    };
  });
}

/** Defensive: also drop any "issue" whose number is a PR number (numbers share one space), and duplicate numbers/shas. */
export function dedupe(issues: GhIssue[], pulls: GhPull[], commits: GhCommit[]) {
  const pullNumbers = new Set(pulls.map((p) => p.number));
  const seenIssue = new Set<number>();
  const seenPull = new Set<number>();
  const seenSha = new Set<string>();
  return {
    issues: issues.filter((i) => !pullNumbers.has(i.number) && !seenIssue.has(i.number) && !!seenIssue.add(i.number)),
    pulls: pulls.filter((p) => !seenPull.has(p.number) && !!seenPull.add(p.number)),
    commits: commits.filter((c) => !seenSha.has(c.sha) && !!seenSha.add(c.sha)),
  };
}
