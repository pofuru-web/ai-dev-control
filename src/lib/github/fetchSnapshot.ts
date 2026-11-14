import type { GitHubSnapshot, SnapshotError, SnapshotErrorCode } from '../../types';
import { BadResponseError, dedupe, normalizeCommits, normalizeIssues, normalizePulls, normalizeRepo } from './normalize';

const REPO_SHAPE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** owner/name; rejects '.' and '..' path segments. */
export const REPO_RE = { test: (v: string) => REPO_SHAPE.test(v) && v.split('/').every((s) => s !== '.' && s !== '..') };
const API = 'https://api.github.com';
export const DEFAULT_TIMEOUT_MS = 10_000;

export class SnapshotFailure extends Error {
  constructor(public error: SnapshotError) { super(error.message); }
}

export interface FetchDeps {
  fetch: typeof fetch;
  token?: string;
  now?: () => Date;
  /** Per-request timeout (covers headers and body). Default 10 s. */
  timeoutMs?: number;
}

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ai-dev-control',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

const fail = (code: SnapshotErrorCode, message: string, resetAt?: string) => new SnapshotFailure({ code, message, resetAt });

async function getJson(deps: FetchDeps, path: string, cancel: AbortSignal): Promise<{ body: unknown; rl?: { limit: number; remaining: number; reset: number } }> {
  const timeout = AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = AbortSignal.any([timeout, cancel]);
  const aborted = () => fail(timeout.aborted ? 'timeout' : 'network', timeout.aborted ? 'GitHub request timed out' : 'request cancelled');
  let res: Response;
  try {
    // GET only: method is fixed here; there is no other call site to GitHub.
    res = await deps.fetch(`${API}${path}`, { method: 'GET', headers: headers(deps.token), signal });
  } catch {
    throw signal.aborted ? aborted() : fail('network', 'could not reach GitHub');
  }
  const limit = Number(res.headers.get('x-ratelimit-limit'));
  const remaining = Number(res.headers.get('x-ratelimit-remaining'));
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  const rl = res.headers.get('x-ratelimit-limit') !== null && [limit, remaining, reset].every(Number.isFinite) ? { limit, remaining, reset } : undefined;
  if (res.status === 429 || (res.status === 403 && rl && rl.remaining === 0)) {
    throw fail('rate_limited', 'GitHub rate limit reached', rl ? new Date(rl.reset * 1000).toISOString() : undefined);
  }
  if (res.status === 404) throw fail('not_found', 'repository not found (or not public)');
  if (!res.ok) throw fail('upstream_error', `GitHub responded with status ${res.status}`);
  let body: unknown;
  try { body = await res.json(); } catch { throw signal.aborted ? aborted() : fail('bad_response', 'GitHub returned invalid JSON'); }
  return { body, rl };
}

/**
 * Fetches repo, issues, pulls, commits (latest 30 each). All-or-nothing: any failure (including
 * a timeout) throws SnapshotFailure, outstanding requests are cancelled, and no snapshot is produced.
 */
export async function fetchSnapshot(deps: FetchDeps, repo: string): Promise<GitHubSnapshot> {
  if (!REPO_RE.test(repo)) throw fail('invalid_repo', 'repo must be owner/name');
  const base = `/repos/${repo}`;
  const q = 'per_page=30';
  const ctl = new AbortController();
  let r, i, p, c;
  try {
    [r, i, p, c] = await Promise.all([
      getJson(deps, base, ctl.signal),
      getJson(deps, `${base}/issues?state=all&sort=created&direction=desc&${q}`, ctl.signal),
      getJson(deps, `${base}/pulls?state=all&sort=created&direction=desc&${q}`, ctl.signal),
      getJson(deps, `${base}/commits?${q}`, ctl.signal),
    ]);
  } catch (e) {
    ctl.abort();
    throw e;
  }
  try {
    const info = normalizeRepo(r.body);
    if (info.private) throw fail('private_repo', 'private repositories are not supported');
    const d = dedupe(normalizeIssues(i.body), normalizePulls(p.body), normalizeCommits(c.body));
    const rls = [r.rl, i.rl, p.rl, c.rl].filter((x): x is NonNullable<typeof x> => !!x);
    const worst = rls.sort((a, b) => a.remaining - b.remaining)[0];
    return {
      repo,
      fetchedAt: (deps.now ?? (() => new Date()))().toISOString(),
      info,
      ...d,
      rateLimit: worst ? { limit: worst.limit, remaining: worst.remaining, resetAt: new Date(worst.reset * 1000).toISOString() } : undefined,
    };
  } catch (e) {
    if (e instanceof SnapshotFailure) throw e;
    if (e instanceof BadResponseError) throw fail('bad_response', e.message);
    throw e;
  }
}
