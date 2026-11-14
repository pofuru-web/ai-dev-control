import type { GitHubSnapshot, SnapshotError } from '../../types';
import { saveSnapshot, type KV } from '../storage';
import { isSnapshot } from '../validate';

/** Client-side limit: must exceed the server's per-request 10 s since the 4 calls run in parallel. */
export const CLIENT_TIMEOUT_MS = 15_000;

export type RefreshResult =
  | { ok: true; snapshot: GitHubSnapshot }
  | { ok: false; error: SnapshotError; keptPrevious: true };

/**
 * Calls the Netlify Function and stores the snapshot only on full success.
 * On any failure the existing cached snapshot is left untouched.
 */
export async function refreshSnapshot(kv: KV, projectId: string, repo: string, fetchImpl: typeof fetch = fetch, timeoutMs = CLIENT_TIMEOUT_MS): Promise<RefreshResult> {
  const keep = (error: SnapshotError): RefreshResult => ({ ok: false, error, keptPrevious: true });
  const signal = AbortSignal.timeout(timeoutMs);
  const timedOut = () => keep({ code: 'timeout', message: 'the server did not answer in time' });
  let res: Response;
  try {
    res = await fetchImpl(`/api/github-snapshot?repo=${encodeURIComponent(repo)}`, { method: 'GET', signal });
  } catch {
    return signal.aborted ? timedOut() : keep({ code: 'network', message: 'could not reach the server' });
  }
  let body: { ok?: boolean; snapshot?: unknown; error?: SnapshotError } | undefined;
  try { body = await res.json(); } catch { return signal.aborted ? timedOut() : keep({ code: 'bad_response', message: 'invalid response from server' }); }
  if (!res.ok || !body?.ok) return keep(body?.error ?? { code: 'upstream_error', message: `status ${res.status}` });
  if (!isSnapshot(body.snapshot)) return keep({ code: 'bad_response', message: 'snapshot failed validation' });
  const saved = saveSnapshot(kv, projectId, body.snapshot);
  if (!saved.ok) return keep({ code: 'upstream_error', message: saved.error });
  return { ok: true, snapshot: body.snapshot };
}
