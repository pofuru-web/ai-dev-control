import { AGENT_KINDS, AGENT_ROLES, type AgentKind, type AgentRole, type GitHubSnapshot, type Id, type LocalData, type Project, type Task, type TaskStatus, type WorkSession } from '../types';
import { REPO_RE } from './github/fetchSnapshot';
import { isWorkDate, workSessionProblems } from './validate';

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
/**
 * Effect of changing a project's GitHub repository on its tasks' manual Issue/PR numbers.
 * A repository counts as changed only if it is a different repository (case-insensitive) and there was a previous
 * repository. Setting a repository on a project that had none keeps existing numbers (no old repository to inherit from).
 */
export function repoChangeImpact(d: LocalData, id: Id, i: ProjectInput): { repoChanged: boolean; tasksWithLinks: number; approvedRevoked: number } {
  const p = d.projects.find((x) => x.id === id);
  const next = parseRepoInput(i.repoText ?? '');
  const changed = !!p?.repo && (!next || repoKey(next) !== repoKey(p.repo));
  if (!changed) return { repoChanged: false, tasksWithLinks: 0, approvedRevoked: 0 };
  const linked = d.tasks.filter((t) => t.projectId === id && (t.links.issueNumber !== undefined || t.links.prNumber !== undefined));
  return { repoChanged: true, tasksWithLinks: linked.length, approvedRevoked: linked.filter((t) => t.ownerApproved).length };
}

export function updateProject(d: LocalData, id: Id, i: ProjectInput, now: string): LocalData {
  const c = cleanProject(i);
  if (!d.projects.some((p) => p.id === id)) err('プロジェクトが見つかりません');
  const impact = repoChangeImpact(d, id, i);
  const tasks = !impact.repoChanged ? d.tasks : d.tasks.map((t) => {
    if (t.projectId !== id || (t.links.issueNumber === undefined && t.links.prNumber === undefined)) return t;
    // Old repository numbers are not carried over. Links are part of what the owner approved, so approval is revoked.
    const next: Task = { ...t, links: {}, updatedAt: now };
    if (t.ownerApproved) { next.status = 'awaiting_owner'; next.ownerApproved = false; next.approvedAt = undefined; }
    return next;
  });
  return { ...d, projects: d.projects.map((p) => (p.id === id ? { ...p, ...c, updatedAt: now } : p)), tasks };
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
export interface AgentInput { name: string; kind: AgentKind; roles: AgentRole[] }

function cleanAgent(i: AgentInput) {
  const name = i.name.trim();
  if (!name) err('担当者名を入力してください');
  if (!(AGENT_KINDS as readonly string[]).includes(i.kind)) err('種別が正しくありません');
  const roles = AGENT_ROLES.filter((r) => i.roles.includes(r)); // canonical order, no duplicates
  if (roles.length === 0) err('役割を1つ以上選択してください');
  if (roles.length !== new Set(i.roles).size) err('役割が正しくありません');
  return { name, kind: i.kind, roles };
}
export function addAgent(d: LocalData, i: AgentInput, id: Id): LocalData {
  return { ...d, agents: [...d.agents, { id, ...cleanAgent(i) }] };
}
/** Edits name/kind/roles. The agent id is kept, so tasks and work sessions stay linked. */
export function updateAgent(d: LocalData, id: Id, i: AgentInput): LocalData {
  if (!d.agents.some((a) => a.id === id)) err('担当者が見つかりません');
  const c = cleanAgent(i);
  return { ...d, agents: d.agents.map((a) => (a.id === id ? { ...a, ...c } : a)) };
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
/**
 * Substantive = what the owner approved: title, notes, project, Issue/PR links.
 * Changing only the assignee is not substantive.
 */
export function isSubstantiveEdit(t: Task, c: ReturnType<typeof cleanTask>): boolean {
  return t.title !== c.title || (t.notes ?? '') !== (c.notes ?? '') || t.projectId !== c.projectId ||
    t.links.issueNumber !== c.links.issueNumber || t.links.prNumber !== c.links.prNumber;
}
export const TASK_MOVE_BLOCKED = 'このタスクには作業時間が記録されているため、別のプロジェクトへ移動できません（作業時間は自動では移動・削除されません）';
/** Number of work sessions linked to a task (the project of such a task cannot be changed). */
export const taskSessionCount = (d: LocalData, id: Id): number => d.workSessions.filter((w) => w.taskId === id).length;

/** True when saving this edit would revoke an existing owner approval (used to warn before saving). */
export function editRevokesApproval(d: LocalData, id: Id, i: TaskInput): boolean {
  const t = d.tasks.find((x) => x.id === id);
  if (!t || !t.ownerApproved) return false;
  return isSubstantiveEdit(t, cleanTask(d, i));
}
/** Editing an approved task's substance revokes the approval and returns it to 'awaiting_owner' (re-approval required). */
export function updateTask(d: LocalData, id: Id, i: TaskInput, now: string): LocalData {
  const c = cleanTask(d, i);
  const t = d.tasks.find((x) => x.id === id);
  if (!t) return err('タスクが見つかりません');
  if (t.projectId !== c.projectId && d.workSessions.some((w) => w.taskId === id)) err(TASK_MOVE_BLOCKED);
  const revoke = t.ownerApproved && isSubstantiveEdit(t, c);
  const next: Task = { ...t, ...c, updatedAt: now };
  if (revoke) { next.status = 'awaiting_owner'; next.ownerApproved = false; next.approvedAt = undefined; }
  return { ...d, tasks: d.tasks.map((x) => (x.id === id ? next : x)) };
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
export interface SessionInput { projectId: Id; taskId?: Id; agentId: Id; mode: 'range' | 'duration'; startedAt?: string; endedAt?: string; durationMinutes?: string; workDate?: string; note?: string }

function buildSession(d: LocalData, i: SessionInput, id: Id): WorkSession {
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
    const wd = (i.workDate ?? '').trim();
    if (wd) {
      if (!isWorkDate(wd)) err('作業日が正しくありません（YYYY-MM-DD）');
      ws.workDate = wd;
    }
  }
  const problems = workSessionProblems(ws);
  if (problems.length) err(`作業時間が不正です: ${problems.join(', ')}`);
  return ws;
}
export function addSession(d: LocalData, i: SessionInput, id: Id): LocalData {
  return { ...d, workSessions: [...d.workSessions, buildSession(d, i, id)] };
}
/** Replaces the editable fields of a session; id and source stay. An undated record stays undated unless the user enters a date. */
export function updateSession(d: LocalData, id: Id, i: SessionInput): LocalData {
  if (!d.workSessions.some((w) => w.id === id)) err('作業時間が見つかりません');
  const ws = buildSession(d, i, id);
  return { ...d, workSessions: d.workSessions.map((w) => (w.id === id ? ws : w)) };
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
export type Period = 'today' | 'week' | 'month' | 'all';
export const PERIOD_LABEL: Record<Period, string> = { today: '今日', week: '今週', month: '今月', all: '全期間' };

const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar date (the browser's time zone) as YYYY-MM-DD. */
export const localDateStr = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Day a session belongs to: the entered workDate, else the local date of startedAt. Undefined for old undated records. */
export function sessionDate(w: WorkSession): string | undefined {
  return w.workDate ?? (w.startedAt ? localDateStr(new Date(w.startedAt)) : undefined);
}
/** Inclusive YYYY-MM-DD bounds. Weeks run Monday to Sunday. 'all' has no bounds. */
export function periodBounds(p: Period, now: Date): { from?: string; to?: string } {
  if (p === 'all') return {};
  if (p === 'today') { const t = localDateStr(now); return { from: t, to: t }; }
  if (p === 'week') {
    const mondayOffset = (now.getDay() + 6) % 7;
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);
    return { from: localDateStr(from), to: localDateStr(to) };
  }
  return { from: localDateStr(new Date(now.getFullYear(), now.getMonth(), 1)), to: localDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
}
/** Undated records are only included in 'all' (no date is ever invented for them). */
export function sessionsInPeriod(d: LocalData, p: Period, now: Date): WorkSession[] {
  if (p === 'all') return d.workSessions;
  const { from, to } = periodBounds(p, now);
  return d.workSessions.filter((w) => { const s = sessionDate(w); return s !== undefined && s >= from! && s <= to!; });
}
export const undatedSessionCount = (d: LocalData): number => d.workSessions.filter((w) => sessionDate(w) === undefined).length;

export function hoursBy(d: LocalData, key: 'projectId' | 'agentId', period: Period = 'all', now: Date = new Date()): { id: Id; minutes: number }[] {
  const m = new Map<Id, number>();
  for (const w of sessionsInPeriod(d, period, now)) m.set(w[key], (m.get(w[key]) ?? 0) + sessionMinutes(w));
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

// ---- GitHub link display (GitHub state and owner approval are separate facts)
export type LinkState =
  | { kind: 'unset' }
  | { kind: 'no_snapshot'; number: number }
  | { kind: 'not_in_latest'; number: number }
  | { kind: 'found'; number: number; label: string; merged?: boolean; url: string };

export function linkInfo(task: Task, snap?: GitHubSnapshot): { issue: LinkState; pr: LinkState } {
  const issue = ((): LinkState => {
    const n = task.links.issueNumber;
    if (n === undefined) return { kind: 'unset' };
    if (!snap) return { kind: 'no_snapshot', number: n };
    const i = snap.issues.find((x) => x.number === n);
    return i ? { kind: 'found', number: n, label: i.state === 'closed' ? 'クローズ' : 'オープン', url: i.url } : { kind: 'not_in_latest', number: n };
  })();
  const pr = ((): LinkState => {
    const n = task.links.prNumber;
    if (n === undefined) return { kind: 'unset' };
    if (!snap) return { kind: 'no_snapshot', number: n };
    const p = snap.pulls.find((x) => x.number === n);
    return p ? { kind: 'found', number: n, label: p.merged ? 'マージ済み' : p.state === 'closed' ? 'クローズ（未マージ）' : 'オープン', merged: p.merged, url: p.url } : { kind: 'not_in_latest', number: n };
  })();
  return { issue, pr };
}

// ---- snapshot cache integrity
export const repoKey = (r: { owner: string; name: string }): string => `${r.owner}/${r.name}`.toLowerCase();
/** Cached snapshots that no longer belong to their project (project gone, repo unset or changed). */
export function staleSnapshotIds(projects: Project[], snaps: Record<Id, GitHubSnapshot>): Id[] {
  return Object.keys(snaps).filter((id) => {
    const p = projects.find((x) => x.id === id);
    return !p?.repo || repoKey(p.repo) !== snaps[id]!.repo.toLowerCase();
  });
}
