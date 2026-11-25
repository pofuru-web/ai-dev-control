import type { LocalData } from '../types';
import { SCHEMA_VERSION, localDataProblems } from './validate';

export type MigrationResult = { ok: true; data: LocalData; fromVersion: number } | { ok: false; error: string };

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * v1 -> v2:
 *  - Agent.role (single) becomes Agent.roles (array). 'developer'/'reviewer' keep their meaning.
 *  - Legacy agent kind 'human' is kept as is (still valid).
 *  - WorkSession gains optional workDate: NOT back-filled (old records without a date stay without one).
 *  - LocalData gains revision (starts at 0).
 * Pure function: never mutates its input; the caller decides whether to persist the result.
 */
function v1ToV2(v: Raw): Raw {
  const agents = Array.isArray(v.agents) ? v.agents : [];
  return {
    ...v,
    schemaVersion: 2,
    revision: 0,
    agents: agents.map((a) => {
      if (!isObj(a)) return a;
      const { role, ...rest } = a;
      if (Array.isArray(a.roles)) return a;
      return { ...rest, roles: typeof role === 'string' ? [role] : [] };
    }),
  };
}

const STEPS: Record<number, (v: Raw) => Raw> = { 1: v1ToV2 };

/** Migrates stored/backup data of any older schema up to SCHEMA_VERSION and validates the result. */
export function migrateLocalData(input: unknown): MigrationResult {
  if (!isObj(input)) return { ok: false, error: 'not an object' };
  const from = input.schemaVersion;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) return { ok: false, error: 'unknown schemaVersion' };
  if (from > SCHEMA_VERSION) return { ok: false, error: `schemaVersion ${from} is newer than supported ${SCHEMA_VERSION}` };
  let cur: Raw = input;
  try {
    for (let v = from; v < SCHEMA_VERSION; v++) {
      const step = STEPS[v];
      if (!step) return { ok: false, error: `no migration from schemaVersion ${v}` };
      cur = step(cur);
    }
  } catch (e) { return { ok: false, error: `migration failed: ${String(e)}` }; }
  const problems = localDataProblems(cur);
  if (problems.length) return { ok: false, error: `migrated data is invalid: ${problems.slice(0, 5).join('; ')}` };
  return { ok: true, data: cur as unknown as LocalData, fromVersion: from };
}
