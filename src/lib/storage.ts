import type { GitHubSnapshot, LocalData } from '../types';
import { SCHEMA_VERSION, emptyLocalData, isLocalData, isSnapshot, localDataProblems } from './validate';
import { migrateLocalData } from './migrations';

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const LOCAL_KEY = 'adc:local:v1';
export const LOCAL_PREV_KEY = 'adc:local:v1:prev';
/** Raw copy of data from an older schema, written once before the first save that would replace it. Never deleted by the app. */
export const premigrationKey = (fromVersion: number, index = 0) => `adc:premigration:v${fromVersion}${index ? `:${index}` : ''}`;
/** Raw copy of a stored value that could not be loaded (corrupt), kept before it is replaced. Never deleted by the app. */
export const corruptCopyKey = (index = 0) => `adc:corrupt-copy:${index}`;
export const snapshotKey = (projectId: string) => `adc:snapshot:v1:${projectId}`;

export type LoadResult =
  | { status: 'ok'; data: LocalData; recoveredFromPrev?: boolean; migratedFrom?: number }
  | { status: 'empty'; data: LocalData }
  | { status: 'readonly_newer_schema'; data: LocalData; foundVersion: number }
  | { status: 'migration_failed'; data: LocalData; fromVersion: number; error: string }
  | { status: 'corrupt'; data: LocalData; problems: string[] };

/**
 * recovery (only set when a write was attempted and then judged bad):
 *  - 'restored_previous': read-back failed; the previous main value was written back and verified.
 *  - 'removed_new': read-back failed on a first-ever save; the unverifiable new value was removed.
 *  - 'restore_failed': could not restore/verify. Previous data may still be in LOCAL_PREV_KEY, and
 *    loadLocal() falls back to it if main is unreadable. The UI must tell the user to export a backup.
 *  - 'skipped_newer_value': at recovery time the stored value was a valid value that is neither ours nor the previous
 *    one, i.e. another tab saved in between. Nothing was written (the other tab's data is left alone).
 *  - 'skipped_unreadable': the stored value could not be read at recovery time, so no blind write-back was made.
 */
export type SaveRecovery = 'restored_previous' | 'removed_new' | 'restore_failed' | 'skipped_newer_value' | 'skipped_unreadable';
/**
 * kind (only for refusals made BEFORE any write was attempted; nothing was changed):
 *  - 'read_failed': the existing data could not be read, so overwriting it blindly was refused.
 *  - 'newer_schema': stored data was written by a newer app version; this version never overwrites it.
 *  - 'conflict': the stored revision differs from the revision this tab loaded (another tab saved in between).
 *  - 'migration_backup_failed': the raw pre-migration copy could not be written, so the old data was not replaced.
 *  - 'corrupt_backup_failed': the stored value is unreadable/corrupt and a raw copy of it could not be kept, so it was not replaced.
 */
export type SaveRefusal = 'read_failed' | 'newer_schema' | 'conflict' | 'migration_backup_failed' | 'corrupt_backup_failed';
export type SaveResult = { ok: true; revision: number } | { ok: false; error: string; recovery?: SaveRecovery; kind?: SaveRefusal };

const versionOf = (raw: string | null): number | undefined => {
  const v = (parse(raw) as { schemaVersion?: unknown } | undefined)?.schemaVersion;
  return typeof v === 'number' ? v : undefined;
};

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
  if (typeof ver === 'number' && ver < SCHEMA_VERSION) {
    // Older schema: migrate in memory only. Nothing is written here; the raw value stays untouched.
    const m = migrateLocalData(parsed);
    if (m.ok) return { status: 'ok', data: m.data, migratedFrom: m.fromVersion };
    return { status: 'migration_failed', data: emptyLocalData(), fromVersion: ver, error: m.error };
  }
  if (isLocalData(parsed)) return { status: 'ok', data: parsed };
  const prev = parsePrev(kv);
  if (prev) return { status: 'ok', data: prev, recoveredFromPrev: true };
  return { status: 'corrupt', data: emptyLocalData(), problems: parsed === undefined ? ['invalid JSON'] : localDataProblems(parsed) };
}

function parsePrev(kv: KV): LocalData | undefined {
  try {
    const p = parse(kv.getItem(LOCAL_PREV_KEY));
    const v = (p as { schemaVersion?: unknown } | undefined)?.schemaVersion;
    if (typeof v === 'number' && v > SCHEMA_VERSION) return undefined;
    if (isLocalData(p)) return p;
    if (typeof v === 'number' && v < SCHEMA_VERSION) { const m = migrateLocalData(p); return m.ok ? m.data : undefined; }
    return undefined;
  } catch { return undefined; }
}

/** Revision stored in a raw main value: undefined if unreadable/invalid, 0 for pre-revision (v1) data. */
function storedRevision(raw: string | null): number | undefined {
  const p = parse(raw);
  if (typeof p !== 'object' || p === null) return undefined;
  const o = p as { schemaVersion?: unknown; revision?: unknown };
  if (typeof o.schemaVersion !== 'number') return undefined;
  if (o.schemaVersion < SCHEMA_VERSION) return migrateLocalData(p).ok ? 0 : undefined;
  return isLocalData(p) ? (o.revision as number) : undefined;
}

/**
 * Saves `data` as revision data.revision + 1. `data.revision` is the revision this caller last loaded or saved;
 * if the stored value has a different revision (another tab saved meanwhile) nothing is written ('conflict').
 * Limit: the check and the write are two synchronous steps, and browsers do not guarantee that localStorage
 * access from different tabs is mutually exclusive, so a collision inside that window cannot be excluded.
 */
export function saveLocal(kv: KV, data: LocalData): SaveResult {
  const problems = localDataProblems(data);
  if (problems.length) return { ok: false, error: `validation failed: ${problems.join('; ')}` };
  let raw: string;
  let nextRevision: number;
  try {
    nextRevision = data.revision + 1;
    raw = JSON.stringify({ ...data, schemaVersion: SCHEMA_VERSION, revision: nextRevision });
    if (!isLocalData(JSON.parse(raw))) return { ok: false, error: 'round-trip validation failed' };
  } catch (e) { return { ok: false, error: `serialize failed: ${String(e)}` }; }

  // Read the existing data first. If we cannot read it we cannot protect it: abort without writing.
  let current: string | null;
  let prevRaw: string | null;
  try {
    current = kv.getItem(LOCAL_KEY);
    prevRaw = kv.getItem(LOCAL_PREV_KEY);
  } catch (e) {
    return { ok: false, kind: 'read_failed', error: `existing data could not be read; nothing was written: ${String(e)}` };
  }
  for (const found of [versionOf(current), versionOf(prevRaw)]) {
    if (found !== undefined && found > SCHEMA_VERSION) {
      return { ok: false, kind: 'newer_schema', error: `stored data has newer schemaVersion ${found} (supported ${SCHEMA_VERSION}); refusing to overwrite` };
    }
  }
  const found = storedRevision(current);
  if (found !== undefined && found !== data.revision) {
    return { ok: false, kind: 'conflict', error: `stored revision ${found} differs from this tab's revision ${data.revision}; another tab or window saved newer data` };
  }
  // A raw copy of the value being replaced is kept first when it cannot be loaded as-is. If the copy fails, do not replace it.
  const curVer = versionOf(current);
  const older = current !== null && curVer !== undefined && curVer < SCHEMA_VERSION;
  const unloadable = current !== null && !older && found === undefined; // corrupt / invalid / unreadable JSON
  if (current !== null && (older || unloadable)) {
    const keyFor = older ? (i: number) => premigrationKey(curVer!, i) : corruptCopyKey;
    try {
      let i = 0;
      for (; i < 5; i++) {
        const existing = kv.getItem(keyFor(i));
        if (existing === current) break;
        if (existing === null) { kv.setItem(keyFor(i), current); break; }
      }
      if (i >= 5) throw new Error('too many raw copies');
    } catch (e) {
      return older
        ? { ok: false, kind: 'migration_backup_failed', error: `could not keep a copy of the old data; it was not replaced: ${String(e)}` }
        : { ok: false, kind: 'corrupt_backup_failed', error: `could not keep a copy of the unreadable data; it was not replaced: ${String(e)}` };
    }
  }
  // Best-effort: keep last good generation. Only copy if it is itself valid and differs from what is there.
  if (current !== null && current !== prevRaw && isLocalData(parse(current))) {
    try { kv.setItem(LOCAL_PREV_KEY, current); } catch { /* ignore: main write decides success */ }
  }
  // Re-check immediately before the main write (narrows, but does not close, the window in which another tab can save).
  try {
    if (kv.getItem(LOCAL_KEY) !== current) {
      return { ok: false, kind: 'conflict', error: 'the stored data changed while this save was being prepared (another tab or window saved); nothing was written to the main data' };
    }
  } catch (e) {
    return { ok: false, kind: 'read_failed', error: `existing data could not be re-read; main data was not written: ${String(e)}` };
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
  if (readBackProblem === undefined) return { ok: true, revision: nextRevision };
  return { ok: false, error: readBackProblem, recovery: restoreAfterBadWrite(kv, current, raw) };
}

/**
 * Called only after our own write was judged bad. It re-reads the stored value first and never overwrites a valid value
 * that is not ours (another tab's save), and never writes blindly when the value cannot be read. Like the rest of this
 * module it is check-then-write, not atomic: a save landing between this check and the write-back is still possible.
 */
function restoreAfterBadWrite(kv: KV, previousRaw: string | null, ourRaw: string): SaveRecovery {
  let now: string | null;
  try { now = kv.getItem(LOCAL_KEY); } catch { return 'skipped_unreadable'; }
  if (now !== null && now !== ourRaw && now !== previousRaw && storedRevision(now) !== undefined) return 'skipped_newer_value';
  try {
    if (previousRaw === null) {
      if (now === null) return 'removed_new';
      kv.removeItem(LOCAL_KEY);
      return kv.getItem(LOCAL_KEY) === null ? 'removed_new' : 'restore_failed';
    }
    if (now === previousRaw) return 'restored_previous';
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
export function saveSnapshot(kv: KV, projectId: string, snap: GitHubSnapshot): { ok: true } | { ok: false; error: string } {
  if (!isSnapshot(snap)) return { ok: false, error: 'invalid snapshot' };
  try {
    kv.setItem(snapshotKey(projectId), JSON.stringify(snap));
    return { ok: true };
  } catch (e) { return { ok: false, error: `write failed (previous snapshot kept): ${String(e)}` }; }
}
