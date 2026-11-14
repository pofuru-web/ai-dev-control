import type { GhCommit, GhIssue, GhPull, GitHubRepoInfo } from '../../types';

type Raw = Record<string, unknown>;

export class BadResponseError extends Error {}

const bad = (m: string): never => { throw new BadResponseError(m); };
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

// Strict readers: a missing or wrongly-typed required field is an error, never a default.
function reqStr(o: Raw, k: string, ctx: string, allowEmpty = false): string {
  const v = o[k];
  if (typeof v !== 'string' || (!allowEmpty && v === '')) bad(`${ctx}.${k}: expected non-empty string`);
  return v as string;
}
function reqDate(o: Raw, k: string, ctx: string): string {
  const v = reqStr(o, k, ctx);
  if (Number.isNaN(Date.parse(v))) bad(`${ctx}.${k}: invalid date`);
  return v;
}
/** null or a valid date string; undefined key or other types are errors. */
function nullableDate(o: Raw, k: string, ctx: string): string | undefined {
  const v = o[k];
  if (v === null) return undefined;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) bad(`${ctx}.${k}: expected date string or null`);
  return v as string;
}
function reqInt(o: Raw, k: string, ctx: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) bad(`${ctx}.${k}: expected positive integer`);
  return v as number;
}
function reqEnum<T extends string>(o: Raw, k: string, allowed: readonly T[], ctx: string): T {
  const v = o[k];
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) bad(`${ctx}.${k}: unexpected value ${JSON.stringify(v)}`);
  return v as T;
}
/** GitHub may return a null user (deleted account); key must still be present. */
function login(o: Raw, k: string, ctx: string): string {
  const v = o[k];
  if (v === null) return '';
  if (!isObj(v) || typeof v.login !== 'string') bad(`${ctx}.${k}: expected user object or null`);
  return (v as Raw).login as string;
}
function reqObj(o: Raw, k: string, ctx: string): Raw {
  const v = o[k];
  if (!isObj(v)) bad(`${ctx}.${k}: expected object`);
  return v as Raw;
}

function requireArray(v: unknown, what: string): Raw[] {
  if (!Array.isArray(v)) bad(`${what}: expected array`);
  return (v as unknown[]).map((x, i) => (isObj(x) ? x : bad(`${what}[${i}]: expected object`)));
}

export function normalizeRepo(raw: unknown): GitHubRepoInfo {
  if (!isObj(raw)) bad('repo: expected object');
  const r = raw as Raw;
  if (typeof r.private !== 'boolean') bad('repo.private: expected boolean');
  return {
    fullName: reqStr(r, 'full_name', 'repo'),
    defaultBranch: reqStr(r, 'default_branch', 'repo'),
    private: r.private as boolean,
    htmlUrl: reqStr(r, 'html_url', 'repo'),
  };
}

/** GitHub's /issues endpoint also lists pull requests; those items carry a `pull_request` key and are dropped. */
export function normalizeIssues(raw: unknown): GhIssue[] {
  return requireArray(raw, 'issues')
    .filter((i) => i.pull_request === undefined)
    .map((i, n) => {
      const ctx = `issues[${n}]`;
      const state = reqEnum(i, 'state', ['open', 'closed'] as const, ctx);
      const closedAt = nullableDate(i, 'closed_at', ctx);
      if (state === 'closed' && closedAt === undefined) bad(`${ctx}: closed issue without closed_at`);
      if (!Array.isArray(i.labels)) bad(`${ctx}.labels: expected array`);
      return {
        number: reqInt(i, 'number', ctx),
        title: reqStr(i, 'title', ctx, true),
        state,
        author: login(i, 'user', ctx),
        createdAt: reqDate(i, 'created_at', ctx),
        closedAt,
        url: reqStr(i, 'html_url', ctx),
        labels: (i.labels as unknown[]).map((l, k) => {
          if (typeof l === 'string') return l;
          if (isObj(l) && typeof l.name === 'string') return l.name;
          return bad(`${ctx}.labels[${k}]: unexpected shape`);
        }),
      };
    });
}

/**
 * merged = merged_at != null; if a boolean `merged` is present it must agree (a contradiction is an error,
 * not silently resolved). A merged PR must be closed. closed + merged_at null = closed without merge.
 */
export function normalizePulls(raw: unknown): GhPull[] {
  return requireArray(raw, 'pulls').map((p, n) => {
    const ctx = `pulls[${n}]`;
    const state = reqEnum(p, 'state', ['open', 'closed'] as const, ctx);
    const mergedAt = nullableDate(p, 'merged_at', ctx);
    const merged = mergedAt !== undefined;
    if (p.merged !== undefined && p.merged !== merged) bad(`${ctx}: merged flag contradicts merged_at`);
    if (merged && state !== 'closed') bad(`${ctx}: merged pull request is not closed`);
    return {
      number: reqInt(p, 'number', ctx),
      title: reqStr(p, 'title', ctx, true),
      state,
      merged,
      mergedAt,
      author: login(p, 'user', ctx),
      head: reqStr(reqObj(p, 'head', ctx), 'ref', `${ctx}.head`),
      base: reqStr(reqObj(p, 'base', ctx), 'ref', `${ctx}.base`),
      createdAt: reqDate(p, 'created_at', ctx),
      url: reqStr(p, 'html_url', ctx),
    };
  });
}

export function normalizeCommits(raw: unknown): GhCommit[] {
  return requireArray(raw, 'commits').map((c, n) => {
    const ctx = `commits[${n}]`;
    const sha = reqStr(c, 'sha', ctx);
    if (!/^[0-9a-f]{40}$/i.test(sha)) bad(`${ctx}.sha: not a 40-hex sha`);
    const commit = reqObj(c, 'commit', ctx);
    const committer = reqObj(commit, 'committer', `${ctx}.commit`);
    const author = isObj(c.author) && typeof c.author.login === 'string' ? c.author.login : reqStr(reqObj(commit, 'author', `${ctx}.commit`), 'name', `${ctx}.commit.author`);
    return {
      sha,
      message: reqStr(commit, 'message', `${ctx}.commit`, true),
      author,
      committedAt: reqDate(committer, 'date', `${ctx}.commit.committer`),
      url: reqStr(c, 'html_url', ctx),
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
