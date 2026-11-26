import { describe, expect, it } from 'vitest';
import * as D from '../../src/lib/domain';
import { exportBackup, parseBackup } from '../../src/lib/backup';
import { LOCAL_KEY, LOCAL_PREV_KEY, corruptCopyKey, loadLocal, saveLocal } from '../../src/lib/storage';
import { emptyLocalData, isLocalData, referenceProblems } from '../../src/lib/validate';
import type { LocalData } from '../../src/types';
import { MemKV, T, sampleData, withRev } from './helpers';

const NOW = '2026-02-01T00:00:00.000Z';
const throwsJa = (f: () => unknown) => expect(f).toThrow(D.DomainError);
const clone = <X,>(x: X): X => JSON.parse(JSON.stringify(x));

// valid data with every kind of reference in use
const full = (): LocalData => {
  const d = sampleData();
  d.tasks[0] = { ...d.tasks[0]!, assigneeAgentId: 'a1' };
  d.workSessions[0] = { ...d.workSessions[0]!, taskId: 't1' };
  return d;
};

describe('M-1 reference integrity and unique ids', () => {
  it('valid data (with and without optional references) has no problems', () => {
    expect(referenceProblems(full())).toEqual([]);
    expect(referenceProblems(sampleData())).toEqual([]); // optional assignee / taskId unset is fine
    expect(referenceProblems(emptyLocalData())).toEqual([]);
  });

  const bad: [string, (d: LocalData) => void, RegExp][] = [
    ['duplicate project id', (d) => { d.projects.push(clone(d.projects[0]!)); }, /projects: duplicate id/],
    ['duplicate agent id', (d) => { d.agents.push(clone(d.agents[0]!)); }, /agents: duplicate id/],
    ['duplicate task id', (d) => { d.tasks.push(clone(d.tasks[0]!)); }, /tasks: duplicate id/],
    ['duplicate work session id', (d) => { d.workSessions.push(clone(d.workSessions[0]!)); }, /workSessions: duplicate id/],
    ['task -> unknown project', (d) => { d.tasks[0]!.projectId = 'ghost'; }, /unknown projectId/],
    ['task -> unknown assignee', (d) => { d.tasks[0]!.assigneeAgentId = 'ghost'; }, /unknown assigneeAgentId/],
    ['session -> unknown project', (d) => { d.workSessions[0]!.projectId = 'ghost'; }, /unknown projectId/],
    ['session -> unknown agent', (d) => { d.workSessions[0]!.agentId = 'ghost'; }, /unknown agentId/],
    ['session -> unknown task', (d) => { d.workSessions[0]!.taskId = 'ghost'; }, /unknown taskId/],
    ['session project differs from its task\'s project', (d) => {
      d.projects.push({ id: 'p2', name: 'Q', status: 'active', createdAt: T, updatedAt: T });
      d.workSessions[0]!.taskId = 't1'; d.workSessions[0]!.projectId = 'p2';
    }, /another project/],
  ];
  it.each(bad)('detects: %s', (_n, mutate, re) => {
    const d = full(); mutate(d);
    expect(referenceProblems(d).join('\n')).toMatch(re);
  });

  it.each(bad)('parseBackup rejects: %s', (_n, mutate) => {
    const d = full(); mutate(d);
    const r = parseBackup(exportBackup(d));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('integrity check failed');
  });

  it('a valid backup with all references still restores', () => {
    const r = parseBackup(exportBackup(full()));
    expect(r.ok).toBe(true);
  });

  it('old-format (v1) backups are checked too', () => {
    const v1 = { schemaVersion: 1, projects: [{ id: 'p1', name: 'P', status: 'active', createdAt: T, updatedAt: T }], agents: [{ id: 'a1', name: 'A', kind: 'other', role: 'developer' }],
      tasks: [{ id: 't1', projectId: 'ghost', title: 'x', status: 'todo', links: {}, ownerApproved: false, createdAt: T, updatedAt: T }], workSessions: [] };
    expect(parseBackup(JSON.stringify({ app: 'ai-dev-control', data: v1 })).ok).toBe(false);
    v1.tasks[0]!.projectId = 'p1';
    expect(parseBackup(JSON.stringify({ app: 'ai-dev-control', data: v1 })).ok).toBe(true);
  });

  it('a rejected backup leaves stored data byte-identical (the caller never writes)', () => {
    const kv = new MemKV();
    saveLocal(kv, withRev(kv, full()));
    const before = new Map(kv.m); const sets = kv.sets;
    const d = full(); d.tasks[0]!.projectId = 'ghost';
    expect(parseBackup(exportBackup(d)).ok).toBe(false);
    expect(kv.m).toEqual(before); expect(kv.sets).toBe(sets);
  });

  it('stored data that already has problems still loads untouched (warn, never delete or fix)', () => {
    const kv = new MemKV();
    const d = full(); d.tasks[0]!.projectId = 'ghost'; d.projects.push(clone(d.projects[0]!));
    const raw = JSON.stringify({ ...d, schemaVersion: 2, revision: 3 });
    kv.m.set(LOCAL_KEY, raw);
    const r = loadLocal(kv);
    expect(r.status).toBe('ok');
    expect(referenceProblems(r.data).length).toBeGreaterThan(1);
    expect(kv.getItem(LOCAL_KEY)).toBe(raw);
    expect(kv.sets).toBe(0);
    expect(saveLocal(kv, r.data).ok).toBe(true); // not locked out
  });

  it('domain operations never create reference problems', () => {
    let d = D.addProject(emptyLocalData(), { name: 'P', status: 'active' }, 'p1', NOW);
    d = D.addAgent(d, { name: 'A', kind: 'other', roles: ['qa'] }, 'a1');
    d = D.addTask(d, { projectId: 'p1', title: 'T', assigneeAgentId: 'a1' }, 't1', NOW);
    d = D.addSession(d, { projectId: 'p1', agentId: 'a1', taskId: 't1', mode: 'duration', durationMinutes: '5' }, 'w1');
    expect(referenceProblems(d)).toEqual([]);
    expect(referenceProblems(D.deleteTask(d, 't1'))).toEqual([]);
    expect(referenceProblems(D.deleteProject(d, 'p1'))).toEqual([]);
  });
});

describe('M-2 recovery never overwrites another tab\'s save', () => {
  const other = (rev: number) => JSON.stringify({ ...sampleData('OTHER TAB'), revision: rev });

  /** KV where another tab replaces the main value right after our first write to it. */
  const raceKv = (otherRaw: string) => {
    const kv = new MemKV();
    const orig = kv.setItem.bind(kv);
    let armed = false;
    kv.setItem = (k, v) => { orig(k, v); if (armed && k === LOCAL_KEY) { armed = false; kv.m.set(LOCAL_KEY, otherRaw); } };
    return { kv, arm: () => { armed = true; } };
  };

  it('valid newer value from another tab is left alone', () => {
    const { kv, arm } = raceKv(other(2));
    saveLocal(kv, withRev(kv, sampleData('old')));
    const data = loadLocal(kv).data;
    arm();
    const r = saveLocal(kv, data);
    expect(r).toMatchObject({ ok: false, error: 'read-back mismatch', recovery: 'skipped_newer_value' });
    expect(kv.getItem(LOCAL_KEY)).toBe(other(2));
    expect(loadLocal(kv).data.projects[0]?.name).toBe('OTHER TAB');
  });

  it('first-ever save: the other tab\'s value is not removed', () => {
    const { kv, arm } = raceKv(other(1));
    arm();
    const r = saveLocal(kv, sampleData('first'));
    expect(r).toMatchObject({ ok: false, recovery: 'skipped_newer_value' });
    expect(kv.getItem(LOCAL_KEY)).toBe(other(1));
  });

  it('no write-back when the current value cannot be read', () => {
    const kv = new MemKV();
    saveLocal(kv, withRev(kv, sampleData('old')));
    const data = loadLocal(kv).data;
    const origSet = kv.setItem.bind(kv); const origGet = kv.getItem.bind(kv);
    let wrote = false; let reads = 0; let mainWrites = 0;
    kv.setItem = (k, v) => { origSet(k, v); if (k === LOCAL_KEY) { wrote = true; mainWrites++; } };
    // reads: [main, prev] initial, [main] recheck, [main] read-back (mismatch), [main] recovery (throws)
    kv.getItem = (k) => {
      if (k === LOCAL_KEY && wrote) { reads++; if (reads === 1) return 'garbage'; throw new Error('SecurityError'); }
      return origGet(k);
    };
    const r = saveLocal(kv, data);
    expect(r).toMatchObject({ ok: false, recovery: 'skipped_unreadable' });
    expect(mainWrites).toBe(1); // only our own write; the recovery wrote nothing to the main key
  });

  it('our own corrupted write is still restored (unchanged behaviour)', () => {
    const kv = new MemKV();
    saveLocal(kv, withRev(kv, sampleData('old')));
    const data = loadLocal(kv).data;
    const orig = kv.setItem.bind(kv);
    kv.setItem = (k, v) => { orig(k, k === LOCAL_KEY && v.includes('"revision":2') ? v.slice(0, 15) : v); };
    expect(saveLocal(kv, data)).toMatchObject({ ok: false, recovery: 'restored_previous' });
    expect(loadLocal(kv).data.projects[0]?.name).toBe('old');
  });

  it('prev-copy race: a save by another tab during our prev write aborts before the main write', () => {
    const kv = new MemKV();
    saveLocal(kv, withRev(kv, sampleData('old')));
    const data = loadLocal(kv).data;
    const orig = kv.setItem.bind(kv);
    kv.setItem = (k, v) => { orig(k, v); if (k === LOCAL_PREV_KEY) kv.m.set(LOCAL_KEY, other(2)); };
    const r = saveLocal(kv, { ...data, projects: [{ ...data.projects[0]!, name: 'mine' }] });
    expect(r).toMatchObject({ ok: false, kind: 'conflict' });
    expect(kv.getItem(LOCAL_KEY)).toBe(other(2)); // not overwritten
  });

  it('prev is not rewritten when it already holds the same value', () => {
    const kv = new MemKV();
    saveLocal(kv, withRev(kv, sampleData('1')));
    saveLocal(kv, withRev(kv, sampleData('2')));
    const current = kv.getItem(LOCAL_KEY);
    kv.m.set(LOCAL_PREV_KEY, current!);
    const setKeys: string[] = []; const orig = kv.setItem.bind(kv);
    kv.setItem = (k, v) => { setKeys.push(k); orig(k, v); };
    saveLocal(kv, withRev(kv, sampleData('3')));
    expect(setKeys).toEqual([LOCAL_KEY]);
  });
});

describe('corrupt data is copied before it is replaced', () => {
  it('keeps a raw copy, then saves; identical corrupt values are not duplicated', () => {
    const kv = new MemKV();
    kv.m.set(LOCAL_KEY, '{broken');
    expect(saveLocal(kv, sampleData('fresh')).ok).toBe(true);
    expect(kv.getItem(corruptCopyKey(0))).toBe('{broken');
    kv.m.set(LOCAL_KEY, '{broken');
    saveLocal(kv, withRev(kv, sampleData('again')));
    expect(kv.getItem(corruptCopyKey(1))).toBeNull();
  });
  it('a different corrupt value goes to the next slot, never over an existing copy', () => {
    const kv = new MemKV();
    kv.m.set(corruptCopyKey(0), 'first copy'); kv.m.set(LOCAL_KEY, '{other broken');
    saveLocal(kv, sampleData());
    expect(kv.getItem(corruptCopyKey(0))).toBe('first copy');
    expect(kv.getItem(corruptCopyKey(1))).toBe('{other broken');
  });
  it('if the copy cannot be written the corrupt value is NOT overwritten', () => {
    const kv = new MemKV();
    kv.m.set(LOCAL_KEY, '{broken');
    kv.failSet = (k) => k.startsWith('adc:corrupt-copy');
    const r = saveLocal(kv, sampleData());
    expect(r).toMatchObject({ ok: false, kind: 'corrupt_backup_failed' });
    expect(kv.getItem(LOCAL_KEY)).toBe('{broken');
  });
  it('a structurally invalid (not unparseable) v2 value is also copied first', () => {
    const kv = new MemKV();
    const raw = JSON.stringify({ schemaVersion: 2, revision: 0, projects: 'x' });
    kv.m.set(LOCAL_KEY, raw);
    saveLocal(kv, sampleData());
    expect(kv.getItem(corruptCopyKey(0))).toBe(raw);
  });
  it('valid current data is not copied as corrupt', () => {
    const kv = new MemKV();
    saveLocal(kv, sampleData('a'));
    saveLocal(kv, withRev(kv, sampleData('b')));
    expect(kv.getItem(corruptCopyKey(0))).toBeNull();
  });
});

describe('M-3 a task with work sessions cannot change project', () => {
  const base = () => {
    let d = D.addProject(emptyLocalData(), { name: 'P', status: 'active' }, 'p1', NOW);
    d = D.addProject(d, { name: 'Q', status: 'active' }, 'p2', NOW);
    d = D.addAgent(d, { name: 'A', kind: 'other', roles: ['qa'] }, 'a1');
    d = D.addTask(d, { projectId: 'p1', title: 'with time' }, 't1', NOW);
    d = D.addTask(d, { projectId: 'p1', title: 'no time' }, 't2', NOW);
    return D.addSession(d, { projectId: 'p1', agentId: 'a1', taskId: 't1', mode: 'duration', durationMinutes: '30' }, 'w1');
  };
  it('is rejected in the domain, with the sessions untouched', () => {
    const d = base();
    const before = JSON.stringify(d);
    throwsJa(() => D.updateTask(d, 't1', { projectId: 'p2', title: 'with time' }, NOW));
    expect(JSON.stringify(d)).toBe(before);
    try { D.updateTask(d, 't1', { projectId: 'p2', title: 'with time' }, NOW); } catch (e) { expect((e as Error).message).toBe(D.TASK_MOVE_BLOCKED); }
  });
  it('a task without sessions moves as before, and stays consistent', () => {
    const d = D.updateTask(base(), 't2', { projectId: 'p2', title: 'no time' }, NOW);
    expect(d.tasks.find((t) => t.id === 't2')?.projectId).toBe('p2');
    expect(referenceProblems(d)).toEqual([]);
  });
  it('other edits of a task with sessions are allowed (same project)', () => {
    const d = D.updateTask(base(), 't1', { projectId: 'p1', title: 'renamed', assigneeAgentId: 'a1' }, NOW);
    expect(d.tasks[0]).toMatchObject({ title: 'renamed', projectId: 'p1' });
    expect(referenceProblems(d)).toEqual([]);
  });
  it('after the sessions are removed the task can move', () => {
    const d = D.updateTask(D.deleteSession(base(), 'w1'), 't1', { projectId: 'p2', title: 'with time' }, NOW);
    expect(d.tasks[0]?.projectId).toBe('p2');
  });
  it('taskSessionCount', () => { expect(D.taskSessionCount(base(), 't1')).toBe(1); expect(D.taskSessionCount(base(), 't2')).toBe(0); });
  it('an approved task with sessions also cannot move (and keeps its approval)', () => {
    let d = D.moveTask(base(), 't1', 'awaiting_owner', NOW);
    d = D.approveTask(d, 't1', NOW);
    throwsJa(() => D.updateTask(d, 't1', { projectId: 'p2', title: 'with time' }, NOW));
    expect(d.tasks[0]).toMatchObject({ status: 'done', ownerApproved: true });
  });
});

describe('M-5 repository change clears Issue/PR links', () => {
  const setup = () => {
    let d = D.addProject(emptyLocalData(), { name: 'P', repoText: 'o/a', status: 'active' }, 'p1', NOW);
    d = D.addProject(d, { name: 'Other', repoText: 'o/z', status: 'active' }, 'p2', NOW);
    d = D.addTask(d, { projectId: 'p1', title: 'issue', issueNumber: '1' }, 't1', NOW);
    d = D.addTask(d, { projectId: 'p1', title: 'pr (approved)', prNumber: '2', issueNumber: '3' }, 't2', NOW);
    d = D.addTask(d, { projectId: 'p1', title: 'nolinks' }, 't3', NOW);
    d = D.addTask(d, { projectId: 'p2', title: 'other project', issueNumber: '9' }, 't4', NOW);
    d = D.moveTask(d, 't2', 'awaiting_owner', NOW);
    return D.approveTask(d, 't2', NOW);
  };
  const edit = (d: LocalData, repoText: string) => D.updateProject(d, 'p1', { name: 'P', repoText, status: 'active' }, '2026-03-01T00:00:00.000Z');
  const task = (d: LocalData, id: string) => d.tasks.find((t) => t.id === id)!;

  it('impact: counts only this project\'s linked tasks and approved ones', () => {
    expect(D.repoChangeImpact(setup(), 'p1', { name: 'P', repoText: 'o/b', status: 'active' })).toEqual({ repoChanged: true, tasksWithLinks: 2, approvedRevoked: 1 });
  });
  it('a different repository clears links of this project\'s tasks only', () => {
    const d = edit(setup(), 'o/b');
    expect(task(d, 't1').links).toEqual({});
    expect(task(d, 't2').links).toEqual({});
    expect(task(d, 't4').links).toEqual({ issueNumber: 9 });
    expect(task(d, 't3')).toEqual(task(setup(), 't3')); // untouched, including updatedAt
    expect(d.projects[0]?.repo).toEqual({ owner: 'o', name: 'b' });
    expect(isLocalData(d)).toBe(true);
  });
  it('approved task whose links are cleared loses its approval and needs re-approval', () => {
    const d = edit(setup(), 'o/b');
    expect(task(d, 't2')).toMatchObject({ status: 'awaiting_owner', ownerApproved: false });
    expect(task(d, 't2').approvedAt).toBeUndefined();
    expect(D.approveTask(d, 't2', NOW).tasks.find((t) => t.id === 't2')).toMatchObject({ status: 'done', ownerApproved: true });
  });
  it('unapproved linked task keeps its status', () => {
    expect(task(edit(setup(), 'o/b'), 't1').status).toBe('todo');
  });
  it('case-only change is the same repository: nothing is cleared', () => {
    const before = setup();
    const d = edit(before, 'O/A');
    expect(D.repoChangeImpact(before, 'p1', { name: 'P', repoText: 'O/A', status: 'active' })).toEqual({ repoChanged: false, tasksWithLinks: 0, approvedRevoked: 0 });
    expect(d.tasks).toEqual(before.tasks);
    expect(task(d, 't2')).toMatchObject({ status: 'done', ownerApproved: true });
    expect(d.projects[0]?.repo).toEqual({ owner: 'O', name: 'A' });
  });
  it('same repository given as a GitHub URL: nothing is cleared', () => {
    const before = setup();
    expect(edit(before, 'https://github.com/o/a').tasks).toEqual(before.tasks);
  });
  it('removing the repository also clears the links (no repository to refer to)', () => {
    const d = edit(setup(), '');
    expect(task(d, 't1').links).toEqual({});
    expect(d.projects[0]?.repo).toBeUndefined();
  });
  it('setting a repository on a project that had none keeps existing numbers', () => {
    let d = D.addProject(emptyLocalData(), { name: 'P', status: 'active' }, 'p1', NOW);
    d = D.addTask(d, { projectId: 'p1', title: 't', issueNumber: '5' }, 't1', NOW);
    const e = D.updateProject(d, 'p1', { name: 'P', repoText: 'o/a', status: 'active' }, NOW);
    expect(e.tasks[0]?.links).toEqual({ issueNumber: 5 });
  });
  it('editing other project fields without touching the repo changes no task', () => {
    const before = setup();
    const d = D.updateProject(before, 'p1', { name: 'Renamed', repoText: 'o/a', status: 'paused' }, NOW);
    expect(d.tasks).toEqual(before.tasks);
  });
  it('invalid repository input is rejected before anything changes', () => {
    const before = setup();
    throwsJa(() => edit(before, 'not a repo'));
    expect(before.tasks.find((t) => t.id === 't1')?.links).toEqual({ issueNumber: 1 });
  });
});
