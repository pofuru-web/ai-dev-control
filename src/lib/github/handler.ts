import type { SnapshotError } from '../../types';
import { REPO_RE, SnapshotFailure, fetchSnapshot } from './fetchSnapshot';

export const DEFAULT_ALLOWED = 'pofuru-web/ai-dev-lab-public';

export interface HandlerEnv {
  GITHUB_TOKEN?: string;
  ALLOWED_REPOS?: string;
}

export function parseAllowList(v: string | undefined): string[] {
  return (v && v.trim() ? v : DEFAULT_ALLOWED).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

const errStatus: Record<SnapshotError['code'], number> = {
  invalid_repo: 400, not_allowed: 403, method_not_allowed: 405, rate_limited: 429,
  not_found: 404, private_repo: 403, upstream_error: 502, bad_response: 502, network: 502, timeout: 504, superseded: 409,
};

/** Builds the request handler. Token is read from server env only and never included in a response. */
export function createHandler(env: HandlerEnv, fetchImpl: typeof fetch = fetch, opts: { timeoutMs?: number } = {}) {
  return async (req: Request): Promise<Response> => {
    const fail = (error: SnapshotError) => json(errStatus[error.code], { ok: false, error });
    if (req.method !== 'GET') return json(405, { ok: false, error: { code: 'method_not_allowed', message: 'GET only' } }, { allow: 'GET' });
    const repo = new URL(req.url).searchParams.get('repo') ?? '';
    if (!REPO_RE.test(repo)) return fail({ code: 'invalid_repo', message: 'repo must be owner/name' });
    if (!parseAllowList(env.ALLOWED_REPOS).includes(repo.toLowerCase())) return fail({ code: 'not_allowed', message: 'repository is not in the allow-list' });
    try {
      const snapshot = await fetchSnapshot({ fetch: fetchImpl, token: env.GITHUB_TOKEN || undefined, timeoutMs: opts.timeoutMs }, repo);
      return json(200, { ok: true, snapshot });
    } catch (e) {
      if (e instanceof SnapshotFailure) return fail(e.error);
      return fail({ code: 'upstream_error', message: 'unexpected error' });
    }
  };
}
