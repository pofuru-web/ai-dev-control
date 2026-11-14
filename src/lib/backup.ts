import type { LocalData } from '../types';
import { SCHEMA_VERSION, localDataProblems } from './validate';

export interface BackupFile {
  app: 'ai-dev-control';
  exportedAt: string;
  data: LocalData;
}

/** Backups contain only human-authored LocalData. GitHub snapshots are never exported. */
export function exportBackup(data: LocalData, now: Date = new Date()): string {
  const file: BackupFile = { app: 'ai-dev-control', exportedAt: now.toISOString(), data };
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
  const problems = localDataProblems(d);
  if (problems.length) return { ok: false, error: `validation failed: ${problems.slice(0, 5).join('; ')}` };
  return { ok: true, data: d as LocalData };
}
