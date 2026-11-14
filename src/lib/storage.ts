import type { GitHubSnapshot, LocalData } from '../types';
import { SCHEMA_VERSION, emptyLocalData, isLocalData, isSnapshot, localDataProblems } from './validate';

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const LOCAL_KEY = 'adc:local:v1';
export const LOCAL_PREV_KEY = 'adc:local:v1:prev';
export const snapshotKey = (projectId: string) => `adc:snapshot:v1:${projectId}`;

export type LoadResult =
  | { status: 'ok'; data: LocalData; recoveredFromPrev?: boolean }
  | { status: 'empty'; data: LocalData }
  | { status: 'readonly_newer_schema'; data: LocalData; foundVersion: number }
  | { status: 'corrupt'; data: LocalData; problems: string[] };

/**
 * recovery (only set when a write was attempted and then judged bad):
 *  - 'restored_previous': read-back failed; the previous main value was written back and verified.
 *  - 'removed_new': read-back failed on a first-ever save; the unverifiable new value was removed.
 *  - 'restore_failed': could not restore/verify. Previous data may still be in LOCAL_PREV_KEY, and
 *    loadLocal() falls back to it if main is unreadable. The UI must tell the user to export a backup.
 */
export type SaveRecovery = 'restored_previous' | 'removed_new' | 'restore_failed';
export type SaveResult = { ok: true } | { ok: false; error: string; recovery?: SaveRecovery };

function parse(raw: string | null): unknown {
  if (raw === null) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

/**
 * Local data lives in ONE key, so each setItem replaces it as a unit (the browser's
 * single-key write). There is NO cross-key atomicity: the previous generation is kept
 * under a second key as a best-effort recovery copy, and the two writes are sequential.
 * Corrupt or failed writes never delete the previous data.
 */
export function loadLocal(kv: KV): LoadResult {
  let raw: string | null;
  try { raw = kv.getItem(LOCAL_KEY); } catch (e) {
    return { status: 'corrupt', data: emptyLocalData(), problems: [`storage read failed: ${String(e)}`] };
  }
  if (raw === null) {
    const prev = parsePrev(kv);
    if (prev) return { status: 'ok', data: prev, recoveredFromPrev: true };
    return { status: 'empty', data: emptyLocalData() };
  }
  const parsed = parse(raw);
  const ver = (parsed as { schemaVersion?: unknown } | undefined)?.schemaVersion;
  if (typeof ver === 'number' && ver > SCHEMA_VERSION) {
    return { status: 'readonly_newer_schema', data: emptyLocalData(), foundVersion: ver };
  }
  if (isLocalData(parsed)) return { status: 'ok', data: parsed };
  const prev = parsePrev(kv);
  if (prev) return { status: 'ok', data: prev, recoveredFromPrev: true };
  return { status: 'corrupt', data: emptyLocalData(), problems: parsed === undefined ? ['invalid JSON'] : localDataProblems(parsed) };
}

function parsePrev(kv: KV): LocalData | undefined {
  try {
    const p = parse(kv.getItem(LOCAL_PREV_KEY));
    return isLocalData(p) ? p : undefined;
  } catch { return undefined; }
}

export function saveLocal(kv: KV, data: LocalData): SaveResult {
  const problems = localDataProblems(data);
  if (problems.length) return { ok: false, error: `validation failed: ${problems.join('; ')}` };
  let raw: string;
  try {
    raw = JSON.stringify({ ...data, schemaVersion: SCHEMA_VERSION });
    if (!isLocalData(JSON.parse(raw))) return { ok: false, error: 'round-trip validation failed' };
  } catch (e) { return { ok: false, error: `serialize failed: ${String(e)}` }; }

  let current: string | null = null;
  try { current = kv.getItem(LOCAL_KEY); } catch { /* proceed without prev copy */ }
  // Best-effort: keep last good generation. Only copy if it is itself valid.
  if (current !== null && isLocalData(parse(current))) {
    try { kv.setItem(LOCAL_PREV_KEY, current); } catch { /* ignore: main write decides success */ }
  }
  try {
    kv.setItem(LOCAL_KEY, raw);
  } catch (e) {
    // setItem failed: the previous value of LOCAL_KEY is expected to be intact; verify.
    return { ok: false, error: `write failed (previous data kept): ${String(e)}` };
  }
  let readBackProblem: string | undefined;
  try {
    if (kv.getItem(LOCAL_KEY) !== raw) readBackProblem = 'read-back mismatch';
  } catch (e) { readBackProblem = `read-back failed: ${String(e)}`; }
  if (readBackProblem === undefined) return { ok: true };
  return { ok: false, error: readBackProblem, recovery: restoreAfterBadWrite(kv, current) };
}

/** Puts the pre-save main value back (or removes the new one if there was none) and verifies it. */
function restoreAfterBadWrite(kv: KV, previousRaw: string | null): SaveRecovery {
  try {
    if (previousRaw === null) {
      kv.removeItem(LOCAL_KEY);
      return kv.getItem(LOCAL_KEY) === null ? 'removed_new' : 'restore_failed';
    }
    kv.setItem(LOCAL_KEY, previousRaw);
    return kv.getItem(LOCAL_KEY) === previousRaw ? 'restored_previous' : 'restore_failed';
  } catch { return 'restore_failed'; }
}

export function loadSnapshot(kv: KV, projectId: string): GitHubSnapshot | undefined {
  try {
    const p = parse(kv.getItem(snapshotKey(projectId)));
    return isSnapshot(p) ? p : undefined;
  } catch { return undefined; }
}

/** Replaces the cached snapshot only if the new one is valid; otherwise leaves the old one. */
export function saveSnapshot(kv: KV, projectId: string, snap: GitHubSnapshot): SaveResult {
  if (!isSnapshot(snap)) return { ok: false, error: 'invalid snapshot' };
  try {
    kv.setItem(snapshotKey(projectId), JSON.stringify(snap));
    return { ok: true };
  } catch (e) { return { ok: false, error: `write failed (previous snapshot kept): ${String(e)}` }; }
}
