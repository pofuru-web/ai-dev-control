import { describe, expect, it } from 'vitest';
import * as D from '../../src/lib/domain';
import { emptyLocalData, isLocalData } from '../../src/lib/validate';
import { ghCommit, ghIssue, ghPull, ghRepo } from './helpers';
import { normalizeCommits, normalizeIssues, normalizePulls, normalizeRepo } from '../../src/lib/github/normalize';
import type { GitHubSnapshot } from '../../src/types';

const NOW = '2026-02-01T00:00:00.000Z';
const throwsJa = (f: () => unknown) => expect(f).toThrow(D.DomainError);
const base = () => D.addAgent(D.addProject(emptyLocalData(), { name: 'P', status: 'active' }, 'p1', NOW), { name: 'Claude', kind: 'claude-code-web', roles: ['developer'] }, 'a1');
const awaiting = () => D.moveTask(D.addTask(base(), { projectId: 'p1', title: 'T', notes: 'n', issueNumber: '1' }, 't1', NOW), 't1', 'awaiting_owner', NOW);
const approved = () => D.approveTask(awaiting(), 't1', NOW);
const input = (over: Partial<D.TaskInput> = {}): D.TaskInput => ({ projectId: 'p1', title: 'T', notes: 'n', issueNumber: '1', ...over });

describe('agents: kinds, multiple roles, editing', () => {
  it('accepts every new kind and every role, multiple at once', () => {
    for (const kind of ['chatgpt', 'claude-code-web', 'claude-code-cli', 'codex-cloud', 'codex-cli', 'gemini', 'other'] as const) {
      const d = D.addAgent(emptyLocalData(), { name: 'x', kind, roles: ['dev_manager', 'dev_lead', 'spec_design', 'developer', 'reviewer', 'qa'] }, 'a');
      expect(d.agents[0]?.roles).toHaveLength(6);
      expect(isLocalData(d)).toBe(true);
    }
  });
  it('requires a name and at least one valid role; roles are deduplicated in canonical order', () => {
    throwsJa(() => D.addAgent(emptyLocalData(), { name: ' ', kind: 'gemini', roles: ['qa'] }, 'a'));
    throwsJa(() => D.addAgent(emptyLocalData(), { name: 'x', kind: 'gemini', roles: [] }, 'a'));
    throwsJa(() => D.addAgent(emptyLocalData(), { name: 'x', kind: 'gemini', roles: ['boss' as never] }, 'a'));
    throwsJa(() => D.addAgent(emptyLocalData(), { name: 'x', kind: 'nope' as never, roles: ['qa'] }, 'a'));
    expect(D.addAgent(emptyLocalData(), { name: 'x', kind: 'gemini', roles: ['qa', 'developer', 'qa'] }, 'a').agents[0]?.roles).toEqual(['developer', 'qa']);
  });
  it('edit keeps the id and every link to tasks and work sessions', () => {
    let d = D.updateTask(D.addTask(base(), { projectId: 'p1', title: 'T' }, 't1', NOW), 't1', input({ assigneeAgentId: 'a1', notes: '', issueNumber: '' }), NOW);
    d = D.addSession(d, { projectId: 'p1', agentId: 'a1', taskId: 't1', mode: 'duration', durationMinutes: '10' }, 'w1');
    const e = D.updateAgent(d, 'a1', { name: 'Renamed', kind: 'codex-cli', roles: ['reviewer', 'qa'] });
    expect(e.agents[0]).toEqual({ id: 'a1', name: 'Renamed', kind: 'codex-cli', roles: ['reviewer', 'qa'] });
    expect(e.tasks[0]?.assigneeAgentId).toBe('a1');
    expect(e.workSessions[0]?.agentId).toBe('a1');
    expect(isLocalData(e)).toBe(true);
    throwsJa(() => D.updateAgent(d, 'ghost', { name: 'x', kind: 'other', roles: ['qa'] }));
    throwsJa(() => D.updateAgent(d, 'a1', { name: 'x', kind: 'other', roles: [] }));
  });
  it('a legacy human agent can be edited without losing its kind unless changed', () => {
    const d = base(); d.agents[0]!.kind = 'human';
    expect(isLocalData(D.updateAgent(d, 'a1', { name: 'Me', kind: 'human', roles: ['developer'] }))).toBe(true);
  });
});

describe('editing an approved task', () => {
  it('title/notes/links/project changes revoke approval and require re-approval', () => {
    for (const change of [{ title: 'T2' }, { notes: 'other' }, { issueNumber: '9' }, { prNumber: '3' }, { notes: '' }] as Partial<D.TaskInput>[]) {
      const d = D.updateTask(approved(), 't1', input(change), '2026-03-01T00:00:00.000Z');
      expect(d.tasks[0]).toMatchObject({ status: 'awaiting_owner', ownerApproved: false });
      expect(d.tasks[0]?.approvedAt).toBeUndefined();
      expect(isLocalData(d)).toBe(true);
      expect(D.approveTask(d, 't1', NOW).tasks[0]).toMatchObject({ status: 'done', ownerApproved: true }); // re-approval works
    }
  });
  it('project change also revokes', () => {
    let d = D.addProject(approved(), { name: 'Q', status: 'active' }, 'p2', NOW);
    d = D.updateTask(d, 't1', input({ projectId: 'p2' }), NOW);
    expect(d.tasks[0]).toMatchObject({ status: 'awaiting_owner', ownerApproved: false });
  });
  it('assignee-only change keeps the approval; no-op save keeps it too', () => {
    let d = D.updateTask(approved(), 't1', input({ assigneeAgentId: 'a1' }), NOW);
    expect(d.tasks[0]).toMatchObject({ status: 'done', ownerApproved: true, approvedAt: NOW });
    d = D.updateTask(d, 't1', input({ assigneeAgentId: 'a1' }), NOW);
    expect(d.tasks[0]).toMatchObject({ status: 'done', ownerApproved: true });
  });
  it('editRevokesApproval predicts exactly this (used for the warning before saving)', () => {
    expect(D.editRevokesApproval(approved(), 't1', input({ title: 'changed' }))).toBe(true);
    expect(D.editRevokesApproval(approved(), 't1', input({ assigneeAgentId: 'a1' }))).toBe(false);
    expect(D.editRevokesApproval(awaiting(), 't1', input({ title: 'changed' }))).toBe(false);
  });
  it('editing an unapproved task never changes its status', () => {
    expect(D.updateTask(awaiting(), 't1', input({ title: 'changed' }), NOW).tasks[0]?.status).toBe('awaiting_owner');
  });
});

describe('work sessions: workDate, editing, periods', () => {
  const d0 = base();
  it('duration sessions can carry a work date; invalid dates are rejected; blank = undated', () => {
    const d = D.addSession(d0, { projectId: 'p1', agentId: 'a1', mode: 'duration', durationMinutes: '30', workDate: '2026-01-05' }, 'w');
    expect(d.workSessions[0]).toMatchObject({ workDate: '2026-01-05', source: 'manual' });
    expect(isLocalData(d)).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '20260105', 'x', '2026-1-5']) throwsJa(() => D.addSession(d0, { projectId: 'p1', agentId: 'a1', mode: 'duration', durationMinutes: '30', workDate: bad }, 'w'));
    expect(D.addSession(d0, { projectId: 'p1', agentId: 'a1', mode: 'duration', durationMinutes: '30', workDate: '' }, 'w').workSessions[0]).not.toHaveProperty('workDate');
  });
  it('edit changes fields, keeps id and source, and validates', () => {
    let d = D.addSession(d0, { projectId: 'p1', agentId: 'a1', mode: 'duration', durationMinutes: '30', workDate: '2026-01-05', note: 'a' }, 'w');
    d = D.updateSession(d, 'w', { projectId: 'p1', agentId: 'a1', mode: 'duration', durationMinutes: '45', workDate: '2026-01-06', note: 'b' });
    expect(d.workSessions[0]).toMatchObject({ id: 'w', durationMinutes: 45, workDate: '2026-01-06', note: 'b', source: 'manual' });
    throwsJa(() => D.updateSession(d, 'w', { projectId: 'p1', agentId: 'a1', mode: 'duration', durationMinutes: '0' }));
    throwsJa(() => D.updateSession(d, 'ghost', { projectId: 'p1', agentId: 'a1', mode: 'duration', durationMinutes: '5' }));
    d = D.updateSession(d, 'w', { projectId: 'p1', agentId: 'a1', mode: 'range', startedAt: '2026-01-07T09:00', endedAt: '2026-01-07T10:00' });
    expect(d.workSessions[0]).toMatchObject({ durationMinutes: 60 });
    expect(d.workSessions[0]).not.toHaveProperty('workDate');
  });
  it('an old undated record stays undated when edited without a date', () => {
    const d = base(); d.workSessions.push({ id: 'old', projectId: 'p1', agentId: 'a1', durationMinutes: 20, source: 'manual' });
    const e = D.updateSession(d, 'old', { projectId: 'p1', agentId: 'a1', mode: 'duration', durationMinutes: '25' });
    expect(e.workSessions[0]).not.toHaveProperty('workDate');
    expect(D.sessionDate(e.workSessions[0]!)).toBeUndefined();
  });

  // Wednesday 2026-01-14 12:00 local
  const now = new Date(2026, 0, 14, 12, 0);
  const at = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12, 0).toISOString();
  const data = () => {
    const d = base();
    const add = (id: string, min: number, workDate?: string, startedAt?: string) => d.workSessions.push({ id, projectId: 'p1', agentId: 'a1', durationMinutes: min, source: 'manual', ...(workDate ? { workDate } : {}), ...(startedAt ? { startedAt, endedAt: new Date(Date.parse(startedAt) + min * 60000).toISOString() } : {}) });
    add('today', 1, '2026-01-14');
    add('mon', 10, '2026-01-12');
    add('sun-prev', 100, '2026-01-11');
    add('sun-next', 1000, '2026-01-18');
    add('mon-next', 10000, '2026-01-19');
    add('month-start', 100000, '2026-01-01');
    add('prev-month', 1000000, '2025-12-31');
    add('range-today', 2, undefined, at(2026, 1, 14));
    add('undated', 5);
    return d;
  };
  it('period bounds: today / Monday-start week / calendar month', () => {
    expect(D.periodBounds('today', now)).toEqual({ from: '2026-01-14', to: '2026-01-14' });
    expect(D.periodBounds('week', now)).toEqual({ from: '2026-01-12', to: '2026-01-18' });
    expect(D.periodBounds('month', now)).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(D.periodBounds('week', new Date(2026, 0, 18, 23, 59))).toEqual({ from: '2026-01-12', to: '2026-01-18' }); // Sunday belongs to the week that started Monday
    expect(D.periodBounds('week', new Date(2026, 0, 19, 0, 0))).toEqual({ from: '2026-01-19', to: '2026-01-25' });
    expect(D.periodBounds('all', now)).toEqual({});
  });
  it('aggregation per period; undated records only in all-time; range sessions use their start date', () => {
    const total = (p: D.Period) => D.hoursBy(data(), 'projectId', p, now)[0]?.minutes ?? 0;
    expect(total('today')).toBe(1 + 2);
    expect(total('week')).toBe(1 + 10 + 1000 + 2);
    expect(total('month')).toBe(1 + 10 + 100 + 1000 + 10000 + 100000 + 2);
    expect(total('all')).toBe(1 + 10 + 100 + 1000 + 10000 + 100000 + 1000000 + 2 + 5);
    expect(D.undatedSessionCount(data())).toBe(1);
    expect(D.hoursBy(data(), 'agentId', 'today', now)).toEqual([{ id: 'a1', minutes: 3 }]);
  });
});

describe('GitHub link display state', () => {
  const snap = (): GitHubSnapshot => ({ repo: 'a/b', fetchedAt: NOW, info: normalizeRepo(ghRepo()), issues: normalizeIssues([ghIssue(1, { state: 'closed', closed_at: NOW })]), pulls: normalizePulls([ghPull(2, { state: 'closed', merged_at: NOW }), ghPull(3, { state: 'closed' })]), commits: normalizeCommits([ghCommit('a')]) });
  const task = (links: { issueNumber?: number; prNumber?: number }) => ({ id: 't', projectId: 'p1', title: 'x', status: 'todo' as const, links, ownerApproved: false, createdAt: NOW, updatedAt: NOW });
  it('distinguishes unset / no snapshot / not in latest 30 / found', () => {
    expect(D.linkInfo(task({}), snap())).toEqual({ issue: { kind: 'unset' }, pr: { kind: 'unset' } });
    expect(D.linkInfo(task({ issueNumber: 1, prNumber: 2 }), undefined)).toEqual({ issue: { kind: 'no_snapshot', number: 1 }, pr: { kind: 'no_snapshot', number: 2 } });
    expect(D.linkInfo(task({ issueNumber: 99, prNumber: 98 }), snap())).toEqual({ issue: { kind: 'not_in_latest', number: 99 }, pr: { kind: 'not_in_latest', number: 98 } });
    const f = D.linkInfo(task({ issueNumber: 1, prNumber: 2 }), snap());
    expect(f.issue).toMatchObject({ kind: 'found', label: 'クローズ' });
    expect(f.pr).toMatchObject({ kind: 'found', label: 'マージ済み', merged: true });
    expect(D.linkInfo(task({ prNumber: 3 }), snap()).pr).toMatchObject({ label: 'クローズ（未マージ）', merged: false });
  });
  it('a merged PR does not change the owner approval (separate facts)', () => {
    const t = task({ prNumber: 2 });
    const info = D.linkInfo(t, snap());
    expect(info.pr).toMatchObject({ merged: true });
    expect(t.ownerApproved).toBe(false);
  });
});

describe('snapshot cache integrity', () => {
  const s = (repo: string): GitHubSnapshot => ({ repo, fetchedAt: NOW, info: normalizeRepo(ghRepo()), issues: [], pulls: [], commits: [] });
  const projects = D.addProject(D.addProject(emptyLocalData(), { name: 'A', repoText: 'o/a', status: 'active' }, 'pa', NOW), { name: 'B', status: 'active' }, 'pb', NOW).projects;
  it('flags caches for deleted projects, repo-less projects and changed repos; case-insensitive match', () => {
    expect(D.staleSnapshotIds(projects, { pa: s('o/a'), pb: s('o/b'), gone: s('o/c') }).sort()).toEqual(['gone', 'pb']);
    expect(D.staleSnapshotIds(projects, { pa: s('O/A') })).toEqual([]);
    expect(D.staleSnapshotIds(projects, { pa: s('o/other') })).toEqual(['pa']);
  });
  it('repoKey is case-insensitive', () => { expect(D.repoKey({ owner: 'Foo', name: 'Bar' })).toBe('foo/bar'); });
});
