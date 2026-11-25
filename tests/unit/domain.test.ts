import { describe, expect, it } from 'vitest';
import * as D from '../../src/lib/domain';
import { emptyLocalData, isLocalData } from '../../src/lib/validate';
import { ghCommit, ghIssue, ghPull, ghRepo, sampleData } from './helpers';
import { normalizeCommits, normalizeIssues, normalizePulls, normalizeRepo } from '../../src/lib/github/normalize';

const NOW = '2026-02-01T00:00:00.000Z';
const base = () => D.addAgent(D.addProject(emptyLocalData(), { name: 'P', status: 'active' }, 'p1', NOW), { name: 'Claude', kind: 'claude-code-web', roles: ['developer'] }, 'a1');
const withTask = () => D.addTask(base(), { projectId: 'p1', title: 'T' }, 't1', NOW);
const throwsJa = (f: () => unknown) => expect(f).toThrow(D.DomainError);

describe('projects', () => {
  it('requires a name and validates repo input', () => {
    throwsJa(() => D.addProject(emptyLocalData(), { name: ' ', status: 'active' }, 'x', NOW));
    throwsJa(() => D.addProject(emptyLocalData(), { name: 'n', repoText: 'bad', status: 'active' }, 'x', NOW));
    throwsJa(() => D.addProject(emptyLocalData(), { name: 'n', repoText: '../x', status: 'active' }, 'x', NOW));
  });
  it('accepts owner/name and github URLs', () => {
    expect(D.parseRepoInput('pofuru-web/ai-dev-lab-public')).toEqual({ owner: 'pofuru-web', name: 'ai-dev-lab-public' });
    expect(D.parseRepoInput('https://github.com/a/b.git/')).toEqual({ owner: 'a', name: 'b' });
    expect(D.parseRepoInput('  ')).toBeUndefined();
  });
  it('update and cascade delete', () => {
    let d = withTask();
    d = D.updateProject(d, 'p1', { name: 'Q', status: 'paused', repoText: 'a/b' }, NOW);
    expect(d.projects[0]).toMatchObject({ name: 'Q', status: 'paused', repo: { owner: 'a', name: 'b' } });
    d = D.addSession(d, { projectId: 'p1', agentId: 'a1', mode: 'duration', durationMinutes: '30' }, 'w1');
    expect(D.projectDeletionImpact(d, 'p1')).toEqual({ tasks: 1, sessions: 1 });
    d = D.deleteProject(d, 'p1');
    expect(d.projects).toEqual([]); expect(d.tasks).toEqual([]); expect(d.workSessions).toEqual([]);
    expect(d.agents).toHaveLength(1);
  });
});

describe('tasks and owner approval', () => {
  it('new task is todo and unapproved', () => {
    expect(withTask().tasks[0]).toMatchObject({ status: 'todo', ownerApproved: false });
  });
  it('cannot be moved to done directly', () => {
    throwsJa(() => D.moveTask(withTask(), 't1', 'done', NOW));
  });
  it('approval only from awaiting_owner', () => {
    throwsJa(() => D.approveTask(withTask(), 't1', NOW));
    let d = D.moveTask(withTask(), 't1', 'awaiting_owner', NOW);
    d = D.approveTask(d, 't1', NOW);
    expect(d.tasks[0]).toMatchObject({ status: 'done', ownerApproved: true, approvedAt: NOW });
    expect(isLocalData(d)).toBe(true);
  });
  it('leaving done revokes the approval', () => {
    let d = D.approveTask(D.moveTask(withTask(), 't1', 'awaiting_owner', NOW), 't1', NOW);
    d = D.moveTask(d, 't1', 'in_progress', NOW);
    expect(d.tasks[0]).toMatchObject({ status: 'in_progress', ownerApproved: false });
    expect(d.tasks[0]?.approvedAt).toBeUndefined();
    expect(isLocalData(d)).toBe(true);
  });
  it('every non-done status is reachable', () => {
    for (const s of D.STATUS_ORDER.filter((x) => x !== 'done')) expect(D.moveTask(withTask(), 't1', s, NOW).tasks[0]?.status).toBe(s);
  });
  it('assignment and manual links are validated', () => {
    const d = D.updateTask(withTask(), 't1', { projectId: 'p1', title: 'T', assigneeAgentId: 'a1', issueNumber: '#1', prNumber: '2' }, NOW);
    expect(d.tasks[0]).toMatchObject({ assigneeAgentId: 'a1', links: { issueNumber: 1, prNumber: 2 } });
    throwsJa(() => D.updateTask(d, 't1', { projectId: 'p1', title: 'T', issueNumber: 'abc' }, NOW));
    throwsJa(() => D.updateTask(d, 't1', { projectId: 'p1', title: 'T', prNumber: '0' }, NOW));
    throwsJa(() => D.updateTask(d, 't1', { projectId: 'p1', title: 'T', assigneeAgentId: 'ghost' }, NOW));
    throwsJa(() => D.updateTask(d, 't1', { projectId: 'p1', title: '' }, NOW));
  });
  it('agent delete: blocked by sessions, otherwise unassigns', () => {
    let d = D.updateTask(withTask(), 't1', { projectId: 'p1', title: 'T', assigneeAgentId: 'a1' }, NOW);
    const withS = D.addSession(d, { projectId: 'p1', agentId: 'a1', mode: 'duration', durationMinutes: '5' }, 'w');
    throwsJa(() => D.deleteAgent(withS, 'a1'));
    d = D.deleteAgent(d, 'a1');
    expect(d.tasks[0]?.assigneeAgentId).toBeUndefined();
  });
  it('deleting a task detaches its sessions', () => {
    let d = D.addSession(withTask(), { projectId: 'p1', taskId: 't1', agentId: 'a1', mode: 'duration', durationMinutes: '5' }, 'w');
    d = D.deleteTask(d, 't1');
    expect(d.workSessions[0]?.taskId).toBeUndefined();
    expect(isLocalData(d)).toBe(true);
  });
});

describe('work sessions', () => {
  it('range mode computes duration; always manual', () => {
    const d = D.addSession(base(), { projectId: 'p1', agentId: 'a1', mode: 'range', startedAt: '2026-01-01T09:00', endedAt: '2026-01-01T10:30' }, 'w');
    expect(d.workSessions[0]).toMatchObject({ source: 'manual', durationMinutes: 90 });
    expect(isLocalData(d)).toBe(true);
  });
  it('rejects bad input', () => {
    const b = base();
    throwsJa(() => D.addSession(b, { projectId: 'p1', agentId: 'a1', mode: 'range', startedAt: '2026-01-01T10:00', endedAt: '2026-01-01T09:00' }, 'w'));
    throwsJa(() => D.addSession(b, { projectId: 'p1', agentId: 'a1', mode: 'range', startedAt: '2026-01-01T10:00' }, 'w'));
    throwsJa(() => D.addSession(b, { projectId: 'p1', agentId: 'a1', mode: 'duration', durationMinutes: '0' }, 'w'));
    throwsJa(() => D.addSession(b, { projectId: 'p1', agentId: 'a1', mode: 'duration', durationMinutes: '1.5' }, 'w'));
    throwsJa(() => D.addSession(b, { projectId: 'nope', agentId: 'a1', mode: 'duration', durationMinutes: '5' }, 'w'));
    throwsJa(() => D.addSession(b, { projectId: 'p1', agentId: 'nope', mode: 'duration', durationMinutes: '5' }, 'w'));
  });
  it('aggregates by project and agent', () => {
    let d = D.addAgent(base(), { name: 'Codex', kind: 'codex-cloud', roles: ['reviewer'] }, 'a2');
    d = D.addSession(d, { projectId: 'p1', agentId: 'a1', mode: 'duration', durationMinutes: '30' }, 'w1');
    d = D.addSession(d, { projectId: 'p1', agentId: 'a1', mode: 'duration', durationMinutes: '15' }, 'w2');
    d = D.addSession(d, { projectId: 'p1', agentId: 'a2', mode: 'duration', durationMinutes: '5' }, 'w3');
    expect(D.hoursBy(d, 'projectId')).toEqual([{ id: 'p1', minutes: 50 }]);
    expect(D.hoursBy(d, 'agentId')).toEqual([{ id: 'a1', minutes: 45 }, { id: 'a2', minutes: 5 }]);
  });
  it('minutes come only from manual fields (never from GitHub data)', () => {
    expect(D.sessionMinutes(sampleData().workSessions[0]!)).toBe(60);
    expect(Object.keys(D).some((k) => /infer|estimate/i.test(k))).toBe(false);
  });
});

describe('dashboard', () => {
  it('counts', () => {
    let d = withTask();
    d = D.addTask(d, { projectId: 'p1', title: 'B' }, 't2', NOW);
    d = D.addTask(d, { projectId: 'p1', title: 'C' }, 't3', NOW);
    d = D.moveTask(d, 't1', 'in_progress', NOW);
    d = D.moveTask(d, 't2', 'awaiting_owner', NOW);
    d = D.moveTask(d, 't3', 'blocked', NOW);
    expect(D.dashboardStats(d)).toEqual({ projects: 1, inProgress: 1, awaitingOwner: 1, blocked: 1 });
  });
  it('agent workload', () => {
    let d = D.updateTask(withTask(), 't1', { projectId: 'p1', title: 'T', assigneeAgentId: 'a1' }, NOW);
    d = D.moveTask(d, 't1', 'in_review', NOW);
    expect(D.agentWorkload(d)[0]).toMatchObject({ inReview: 1, inProgress: 0, minutes: 0 });
  });
  it('recent activity merges, sorts, labels merged PRs; last sync is the newest', () => {
    const snap = (repo: string, fetchedAt: string) => ({ repo, fetchedAt, info: normalizeRepo(ghRepo()), issues: normalizeIssues([ghIssue(1)]), pulls: normalizePulls([ghPull(2, { state: 'closed', merged_at: '2026-01-05T00:00:00Z' })]), commits: normalizeCommits([ghCommit('a')]) });
    const a = D.recentActivity([snap('a/b', '2026-03-01T00:00:00Z'), snap('c/d', '2026-04-01T00:00:00Z')], 4);
    expect(a).toHaveLength(4);
    expect(a[0]?.kind).toBe('pr');
    expect(a[0]?.detail).toBe('マージ済み');
    expect(D.lastSyncAt([snap('a/b', '2026-03-01T00:00:00Z'), snap('c/d', '2026-04-01T00:00:00Z')])).toBe('2026-04-01T00:00:00Z');
    expect(D.lastSyncAt([])).toBeUndefined();
  });
});
