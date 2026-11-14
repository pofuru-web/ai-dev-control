import type { LocalData, Project, Agent, Task, WorkSession, GitHubSnapshot } from '../types';

export const SCHEMA_VERSION = 1;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown) => v === undefined || isStr(v);
const isDate = (v: unknown): v is string => isStr(v) && !Number.isNaN(Date.parse(v));
const optDate = (v: unknown) => v === undefined || isDate(v);

export function isProject(v: unknown): v is Project {
  return (
    isObj(v) && isStr(v.id) && isStr(v.name) && optStr(v.description) &&
    ['active', 'paused', 'done'].includes(v.status as string) &&
    (v.repo === undefined || (isObj(v.repo) && isStr(v.repo.owner) && isStr(v.repo.name))) &&
    isDate(v.createdAt) && isDate(v.updatedAt)
  );
}

export function isAgent(v: unknown): v is Agent {
  return (
    isObj(v) && isStr(v.id) && isStr(v.name) &&
    ['claude-code-web', 'codex-cloud', 'human', 'other'].includes(v.kind as string) &&
    ['developer', 'reviewer'].includes(v.role as string)
  );
}

export function isTask(v: unknown): v is Task {
  return (
    isObj(v) && isStr(v.id) && isStr(v.projectId) && isStr(v.title) && optStr(v.notes) &&
    ['todo', 'in_progress', 'in_review', 'awaiting_owner', 'done', 'blocked'].includes(v.status as string) &&
    optStr(v.assigneeAgentId) && isObj(v.links) && typeof v.ownerApproved === 'boolean' &&
    optDate(v.approvedAt) && isDate(v.createdAt) && isDate(v.updatedAt)
  );
}

/** Returns a list of problems; empty = valid. Checks time/duration consistency. */
export function workSessionProblems(v: unknown): string[] {
  if (!isObj(v)) return ['not an object'];
  const p: string[] = [];
  if (!isStr(v.id)) p.push('id');
  if (!isStr(v.projectId)) p.push('projectId');
  if (!isStr(v.agentId)) p.push('agentId');
  if (!optStr(v.taskId)) p.push('taskId');
  if (v.source !== 'manual') p.push('source must be "manual"');
  if (!optDate(v.startedAt)) p.push('startedAt invalid');
  if (!optDate(v.endedAt)) p.push('endedAt invalid');
  const d = v.durationMinutes;
  if (d !== undefined && (typeof d !== 'number' || !Number.isFinite(d) || d < 0)) p.push('durationMinutes must be >= 0');
  if (p.length) return p;
  const s = v.startedAt === undefined ? undefined : Date.parse(v.startedAt as string);
  const e = v.endedAt === undefined ? undefined : Date.parse(v.endedAt as string);
  if (s !== undefined && e !== undefined) {
    if (e < s) p.push('endedAt is before startedAt');
    else if (typeof d === 'number' && Math.abs((e - s) / 60000 - d) > 1) p.push('durationMinutes does not match startedAt/endedAt');
  }
  if ((s === undefined) !== (e === undefined) && d === undefined) p.push('start and end must both be set (or give durationMinutes)');
  if (s === undefined && e === undefined && d === undefined) p.push('no time information');
  return p;
}

export const isWorkSession = (v: unknown): v is WorkSession => workSessionProblems(v).length === 0;

export function localDataProblems(v: unknown): string[] {
  if (!isObj(v)) return ['not an object'];
  const p: string[] = [];
  if (typeof v.schemaVersion !== 'number') p.push('schemaVersion missing');
  for (const [key, guard] of [['projects', isProject], ['agents', isAgent], ['tasks', isTask]] as const) {
    const arr = v[key];
    if (!Array.isArray(arr)) p.push(`${key} must be an array`);
    else arr.forEach((x, i) => { if (!guard(x)) p.push(`${key}[${i}] invalid`); });
  }
  if (!Array.isArray(v.workSessions)) p.push('workSessions must be an array');
  else v.workSessions.forEach((x, i) => workSessionProblems(x).forEach((m) => p.push(`workSessions[${i}]: ${m}`)));
  return p;
}

export function isLocalData(v: unknown): v is LocalData {
  return localDataProblems(v).length === 0;
}

const isInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isState = (v: unknown) => v === 'open' || v === 'closed';
const all = (v: unknown, f: (x: Record<string, unknown>) => boolean) => Array.isArray(v) && v.every((x) => isObj(x) && f(x));

/** Structural check of a snapshot received from the network or read from storage. */
export function isSnapshot(v: unknown): v is GitHubSnapshot {
  return (
    isObj(v) && isStr(v.repo) && isDate(v.fetchedAt) &&
    isObj(v.info) && isStr(v.info.fullName) && typeof v.info.private === 'boolean' && v.info.private === false &&
    all(v.issues, (i) => isInt(i.number) && isState(i.state) && isStr(i.title) && isDate(i.createdAt) && Array.isArray(i.labels)) &&
    all(v.pulls, (p) => isInt(p.number) && isState(p.state) && typeof p.merged === 'boolean' && isStr(p.title) && isDate(p.createdAt) &&
      (p.merged ? p.state === 'closed' && isDate(p.mergedAt) : p.mergedAt === undefined)) &&
    all(v.commits, (c) => isStr(c.sha) && isStr(c.message) && isDate(c.committedAt))
  );
}

export const emptyLocalData = (): LocalData => ({ schemaVersion: SCHEMA_VERSION, projects: [], agents: [], tasks: [], workSessions: [] });
