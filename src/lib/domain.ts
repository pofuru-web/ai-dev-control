import type { Agent, GitHubSnapshot, Id, LocalData, Project, Task, TaskStatus, WorkSession } from '../types';
import { REPO_RE } from './github/fetchSnapshot';
import { workSessionProblems } from './validate';

/** Pure data operations. They never touch storage; on invalid input they throw Error with a user-facing (Japanese) message. */

export const STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'awaiting_owner', 'done', 'blocked'];
export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '未着手', in_progress: '作業中', in_review: 'レビュー中', awaiting_owner: '承認待ち', done: '完了', blocked: 'ブロック中',
};

export class DomainError extends Error {}
const err = (m: string): never => { throw new DomainError(m); };

export function parseRepoInput(input: string): { owner: string; name: string } | undefined {
  const t = input.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  if (!t) return undefined;
  if (!REPO_RE.test(t)) return err('リポジトリは「owner/name」または https://github.com/owner/name の形式で入力してください');
  const [owner, name] = t.split('/') as [string, string];
  return { owner, name };
}

// ---- projects
export interface ProjectInput { name: string; description?: string; repoText?: string; status: Project['status'] }

function cleanProject(i: ProjectInput) {
  const name = i.name.trim();
  if (!name) err('プロジェクト名を入力してください');
  const repo = parseRepoInput(i.repoText ?? '');
  const description = i.description?.trim() || undefined;
  return { name, description, repo, status: i.status };
}

export function addProject(d: LocalData, i: ProjectInput, id: Id, now: string): LocalData {
  const c = cleanProject(i);
  const p: Project = { id, ...c, createdAt: now, updatedAt: now };
  return { ...d, projects: [...d.projects, p] };
}
export function updateProject(d: LocalData, id: Id, i: ProjectInput, now: string): LocalData {
  const c = cleanProject(i);
  if (!d.projects.some((p) => p.id === id)) err('プロジェクトが見つかりません');
  return { ...d, projects: d.projects.map((p) => (p.id === id ? { ...p, ...c, updatedAt: now } : p)) };
}
export function projectDeletionImpact(d: LocalData, id: Id) {
  return { tasks: d.tasks.filter((t) => t.projectId === id).length, sessions: d.workSessions.filter((w) => w.projectId === id).length };
}
export function deleteProject(d: LocalData, id: Id): LocalData {
  return {
    ...d,
    projects: d.projects.filter((p) => p.id !== id),
    tasks: d.tasks.filter((t) => t.projectId !== id),
    workSessions: d.workSessions.filter((w) => w.projectId !== id),
  };
}

// ---- agents
export function addAgent(d: LocalData, i: Pick<Agent, 'name' | 'kind' | 'role'>, id: Id): LocalData {
  const name = i.name.trim();
  if (!name) err('担当者名を入力してください');
  return { ...d, agents: [...d.agents, { id, name, kind: i.kind, role: i.role }] };
}
export function deleteAgent(d: LocalData, id: Id): LocalData {
  if (d.workSessions.some((w) => w.agentId === id)) err('作業時間の記録があるため削除できません');
  return { ...d, agents: d.agents.filter((a) => a.id !== id), tasks: d.tasks.map((t) => (t.assigneeAgentId === id ? { ...t, assigneeAgentId: undefined } : t)) };
}

// ---- tasks
export interface TaskInput { projectId: Id; title: string; notes?: string; assigneeAgentId?: Id; issueNumber?: string; prNumber?: string }

function linkNum(v: string | undefined, label: string): number | undefined {
  const t = (v ?? '').trim().replace(/^#/, '');
  if (!t) return undefined;
  if (!/^[1-9][0-9]*$/.test(t)) err(`${label}番号は正の整数で入力してください`);
  return Number(t);
}

function cleanTask(d: LocalData, i: TaskInput) {
  const title = i.title.trim();
  if (!title) err('タスク名を入力してください');
  if (!d.projects.some((p) => p.id === i.projectId)) err('プロジェクトを選択してください');
  if (i.assigneeAgentId && !d.agents.some((a) => a.id === i.assigneeAgentId)) err('担当者が見つかりません');
  return {
    projectId: i.projectId, title, notes: i.notes?.trim() || undefined,
    assigneeAgentId: i.assigneeAgentId || undefined,
    links: { issueNumber: linkNum(i.issueNumber, 'Issue'), prNumber: linkNum(i.prNumber, 'PR') },
  };
}

export function addTask(d: LocalData, i: TaskInput, id: Id, now: string): LocalData {
  const t: Task = { id, ...cleanTask(d, i), status: 'todo', ownerApproved: false, createdAt: now, updatedAt: now };
  return { ...d, tasks: [...d.tasks, t] };
}
export function updateTask(d: LocalData, id: Id, i: TaskInput, now: string): LocalData {
  const c = cleanTask(d, i);
  if (!d.tasks.some((t) => t.id === id)) err('タスクが見つかりません');
  return { ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...c, updatedAt: now } : t)) };
}
/** Moves a task. 'done' is reachable only through approveTask; leaving 'done' revokes the approval. */
export function moveTask(d: LocalData, id: Id, to: TaskStatus, now: string): LocalData {
  const t = d.tasks.find((x) => x.id === id);
  if (!t) return err('タスクが見つかりません');
  if (to === t.status) return d;
  if (to === 'done') err('「完了」は家主の承認操作でのみ設定できます（承認待ちのタスクで「承認する」を押してください）');
  const next: Task = { ...t, status: to, updatedAt: now };
  if (t.ownerApproved) { next.ownerApproved = false; next.approvedAt = undefined; }
  return { ...d, tasks: d.tasks.map((x) => (x.id === id ? next : x)) };
}
/** Explicit owner approval: allowed only from 'awaiting_owner'. */
export function approveTask(d: LocalData, id: Id, now: string): LocalData {
  const t = d.tasks.find((x) => x.id === id);
  if (!t) return err('タスクが見つかりません');
  if (t.status !== 'awaiting_owner') err('承認できるのは「承認待ち」のタスクだけです');
  return { ...d, tasks: d.tasks.map((x) => (x.id === id ? { ...x, status: 'done', ownerApproved: true, approvedAt: now, updatedAt: now } : x)) };
}
export function deleteTask(d: LocalData, id: Id): LocalData {
  return { ...d, tasks: d.tasks.filter((t) => t.id !== id), workSessions: d.workSessions.map((w) => (w.taskId === id ? { ...w, taskId: undefined } : w)) };
}

// ---- work sessions (manual only)
export interface SessionInput { projectId: Id; taskId?: Id; agentId: Id; mode: 'range' | 'duration'; startedAt?: string; endedAt?: string; durationMinutes?: string; note?: string }

export function addSession(d: LocalData, i: SessionInput, id: Id): LocalData {
  if (!d.projects.some((p) => p.id === i.projectId)) err('プロジェクトを選択してください');
  if (!d.agents.some((a) => a.id === i.agentId)) err('担当者を選択してください');
  if (i.taskId && !d.tasks.some((t) => t.id === i.taskId && t.projectId === i.projectId)) err('タスクがプロジェクトに属していません');
  const ws: WorkSession = { id, projectId: i.projectId, taskId: i.taskId || undefined, agentId: i.agentId, source: 'manual', note: i.note?.trim() || undefined };
  if (i.mode === 'range') {
    if (!i.startedAt || !i.endedAt) err('開始と終了の日時を入力してください');
    const s = new Date(i.startedAt!), e = new Date(i.endedAt!);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) err('日時が正しくありません');
    if (e < s) err('終了は開始より後にしてください');
    ws.startedAt = s.toISOString(); ws.endedAt = e.toISOString();
    ws.durationMinutes = Math.round((e.getTime() - s.getTime()) / 60000);
  } else {
    const t = (i.durationMinutes ?? '').trim();
    if (!/^[0-9]+$/.test(t) || Number(t) <= 0) err('所要時間は1以上の整数（分）で入力してください');
    ws.durationMinutes = Number(t);
  }
  const problems = workSessionProblems(ws);
  if (problems.length) err(`作業時間が不正です: ${problems.join(', ')}`);
  return { ...d, workSessions: [...d.workSessions, ws] };
}
export function deleteSession(d: LocalData, id: Id): LocalData {
  return { ...d, workSessions: d.workSessions.filter((w) => w.id !== id) };
}

// ---- aggregation / dashboard
export function sessionMinutes(w: WorkSession): number {
  if (typeof w.durationMinutes === 'number') return w.durationMinutes;
  if (w.startedAt && w.endedAt) return Math.max(0, Math.round((Date.parse(w.endedAt) - Date.parse(w.startedAt)) / 60000));
  return 0;
}
export function hoursBy(d: LocalData, key: 'projectId' | 'agentId'): { id: Id; minutes: number }[] {
  const m = new Map<Id, number>();
  for (const w of d.workSessions) m.set(w[key], (m.get(w[key]) ?? 0) + sessionMinutes(w));
  return [...m].map(([id, minutes]) => ({ id, minutes })).sort((a, b) => b.minutes - a.minutes);
}

export function dashboardStats(d: LocalData) {
  const count = (s: TaskStatus) => d.tasks.filter((t) => t.status === s).length;
  return {
    projects: d.projects.length,
    inProgress: count('in_progress'),
    awaitingOwner: count('awaiting_owner'),
    blocked: count('blocked'),
  };
}
export function agentWorkload(d: LocalData) {
  const mins = new Map(hoursBy(d, 'agentId').map((x) => [x.id, x.minutes]));
  return d.agents.map((a) => {
    const mine = d.tasks.filter((t) => t.assigneeAgentId === a.id);
    const c = (s: TaskStatus) => mine.filter((t) => t.status === s).length;
    return { agent: a, inProgress: c('in_progress'), inReview: c('in_review'), blocked: c('blocked'), minutes: mins.get(a.id) ?? 0 };
  });
}

export interface Activity { kind: 'issue' | 'pr' | 'commit'; repo: string; title: string; at: string; detail: string; url: string }
export function recentActivity(snaps: GitHubSnapshot[], limit = 10): Activity[] {
  const out: Activity[] = [];
  for (const s of snaps) {
    for (const i of s.issues) out.push({ kind: 'issue', repo: s.repo, title: `#${i.number} ${i.title}`, at: i.createdAt, detail: i.state === 'closed' ? 'クローズ' : 'オープン', url: i.url });
    for (const p of s.pulls) out.push({ kind: 'pr', repo: s.repo, title: `#${p.number} ${p.title}`, at: p.merged && p.mergedAt ? p.mergedAt : p.createdAt, detail: p.merged ? 'マージ済み' : p.state === 'closed' ? 'クローズ（未マージ）' : 'オープン', url: p.url });
    for (const c of s.commits) out.push({ kind: 'commit', repo: s.repo, title: c.message.split('\n')[0] ?? '', at: c.committedAt, detail: c.sha.slice(0, 7), url: c.url });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}
export function lastSyncAt(snaps: GitHubSnapshot[]): string | undefined {
  return snaps.map((s) => s.fetchedAt).sort().at(-1);
}
