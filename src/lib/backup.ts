import type { LocalData } from '../types';
import { SCHEMA_VERSION } from './validate';
import { migrateLocalData } from './migrations';

export interface BackupFile {
  app: 'ai-dev-control';
  exportedAt: string;
  data: Omit<LocalData, 'revision'> & { revision?: number };
}

/** Backups contain only human-authored LocalData. GitHub snapshots are never exported. */
export function exportBackup(data: LocalData, now: Date = new Date()): string {
  // `revision` is a per-browser save counter used for multi-tab conflict detection; it is not part of a backup.
  const { revision: _revision, ...rest } = data;
  void _revision;
  const file = { app: 'ai-dev-control' as const, exportedAt: now.toISOString(), data: rest };
  return JSON.stringify(file, null, 2);
}

export type ImportResult = { ok: true; data: LocalData } | { ok: false; error: string };

/** Parses and validates only. Never writes: the caller decides whether to replace current data. */
export function parseBackup(text: string): ImportResult {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return { ok: false, error: 'invalid JSON' }; }
  if (typeof v !== 'object' || v === null) return { ok: false, error: 'not a backup file' };
  const f = v as Partial<BackupFile>;
  if (f.app !== 'ai-dev-control') return { ok: false, error: 'not an ai-dev-control backup' };
  const d = f.data as { schemaVersion?: unknown } | undefined;
  if (typeof d?.schemaVersion === 'number' && d.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, error: `backup schemaVersion ${d.schemaVersion} is newer than supported ${SCHEMA_VERSION}` };
  }
  // Current-format backups carry no revision; give them 0 so they validate. (The caller re-bases it on restore.)
  const candidate = d && typeof d === 'object' && d.schemaVersion === SCHEMA_VERSION && (d as { revision?: unknown }).revision === undefined ? { ...d, revision: 0 } : d;
  const m = migrateLocalData(candidate);
  if (!m.ok) return { ok: false, error: `validation failed: ${m.error}` };
  return { ok: true, data: m.data };
}
