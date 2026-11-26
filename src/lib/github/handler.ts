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

/** How long Netlify's CDN may reuse a successful response. A manual sync can therefore return data up to this old. */
export const CDN_CACHE_SECONDS = 60;

/**
 * Cache-related headers (Netlify):
 *  - Netlify-Vary: query=repo  -> the cache key uses ONLY the `repo` parameter (explicit, so different repositories can
 *    never share an entry and extra random parameters cannot bypass the cache). It must be identical on every response
 *    for a URL, so it is sent on errors too.
 *  - Success: Netlify-CDN-Cache-Control caches at Netlify's CDN only; Cache-Control tells browsers to revalidate every time.
 *  - Errors: explicitly not cached anywhere.
 * A cached success is served by the CDN WITHOUT running this function, so the allow-list is not consulted for hits
 * (bounded by CDN_CACHE_SECONDS; Netlify drops cached responses on each deploy).
 */
const VARY = { 'netlify-vary': 'query=repo' };
const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store', ...VARY, ...extra } });
const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=0, must-revalidate', 'netlify-cdn-cache-control': `public, max-age=${CDN_CACHE_SECONDS}`, ...VARY } });

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
      return okJson({ ok: true, snapshot });
    } catch (e) {
      if (e instanceof SnapshotFailure) return fail(e.error);
      return fail({ code: 'upstream_error', message: 'unexpected error' });
    }
  };
}
