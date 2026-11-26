import { useState } from 'react';
import { useApp } from '../state/AppState';
import { STATUS_LABEL, STATUS_ORDER, addTask, approveTask, deleteTask, editRevokesApproval, linkInfo, moveTask, taskSessionCount, updateTask, type LinkState, type TaskInput } from '../lib/domain';
import { fmtDateTime, safeGithubUrl } from '../lib/format';
import type { Task, TaskStatus } from '../types';
import { Badge, Banner, Btn, Confirm, Empty, Field, Modal, inputCls } from '../ui/kit';

const COL_TONE: Record<TaskStatus, string> = { todo: 'border-slate-600', in_progress: 'border-emerald-600', in_review: 'border-sky-600', awaiting_owner: 'border-amber-500', done: 'border-violet-600', blocked: 'border-rose-600' };

function TaskForm({ initial, defaultProject, onClose }: { initial?: Task; defaultProject: string; onClose: () => void }) {
  const app = useApp();
  const [v, setV] = useState<TaskInput>({
    projectId: initial?.projectId ?? defaultProject, title: initial?.title ?? '', notes: initial?.notes ?? '',
    assigneeAgentId: initial?.assigneeAgentId ?? '', issueNumber: initial?.links.issueNumber?.toString() ?? '', prNumber: initial?.links.prNumber?.toString() ?? '',
  });
  const [error, setError] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const sessionCount = initial ? taskSessionCount(app.data, initial.id) : 0;
  const save = () => {
    const now = app.now();
    const r = app.run((d) => (initial ? updateTask(d, initial.id, v, now) : addTask(d, v, app.newId(), now)));
    if (r.ok) onClose(); else { setError(r.error); setConfirmRevoke(false); }
  };
  const submit = () => {
    let revokes: boolean;
    try { revokes = !!initial && editRevokesApproval(app.data, initial.id, v); } catch { revokes = false; /* validation errors surface from save() */ }
    if (revokes) setConfirmRevoke(true); else save();
  };
  return (
    <Modal title={initial ? 'タスクを編集' : 'タスクを追加'} onClose={onClose}>
      <div className="space-y-3">
        {initial?.ownerApproved && (
          <Banner tone="warn" title="このタスクは家主承認済みです">
            <p>タイトル・メモ・プロジェクト・Issue/PR番号を変更して保存すると、承認が取り消されて「承認待ち」に戻り、家主の再承認が必要になります。担当者の変更のみなら承認は維持されます。</p>
          </Banner>
        )}
        <Field label="プロジェクト">
          <select className={inputCls} value={v.projectId} disabled={sessionCount > 0} onChange={(e) => setV({ ...v, projectId: e.target.value })}>
            <option value="">選択してください</option>
            {app.data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {sessionCount > 0 && <span data-testid="move-blocked" className="mt-1 block text-xs text-amber-300">作業時間が {sessionCount} 件記録されているため、別のプロジェクトへは移動できません（作業時間は自動では移動・削除されません）。</span>}
        </Field>
        <Field label="タスク名"><input className={inputCls} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="メモ（任意）"><textarea className={inputCls} rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
        <Field label="AI担当者">
          <select className={inputCls} value={v.assigneeAgentId} onChange={(e) => setV({ ...v, assigneeAgentId: e.target.value })}>
            <option value="">未割り当て</option>
            {app.data.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Issue番号（手動紐付け）"><input className={inputCls} inputMode="numeric" value={v.issueNumber} onChange={(e) => setV({ ...v, issueNumber: e.target.value })} placeholder="1" /></Field>
          <Field label="PR番号（手動紐付け）"><input className={inputCls} inputMode="numeric" value={v.prNumber} onChange={(e) => setV({ ...v, prNumber: e.target.value })} placeholder="2" /></Field>
        </div>
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        <div className="flex justify-end gap-2"><Btn onClick={onClose}>キャンセル</Btn><Btn tone="primary" onClick={submit}>保存</Btn></div>
      </div>
      {confirmRevoke && (
        <Confirm title="承認が取り消されます" confirmLabel="承認を取り消して保存" onCancel={() => setConfirmRevoke(false)}
          body={<><p>この変更を保存すると家主承認が取り消され、タスクは「承認待ち」に戻ります。</p><p>完了にするには、あらためて家主の承認操作が必要です。</p></>}
          onConfirm={save} />
      )}
    </Modal>
  );
}

function LinkLine({ label, st }: { label: string; st: LinkState }) {
  if (st.kind === 'unset') return <div className="text-slate-500">{label}: 紐付けなし</div>;
  if (st.kind === 'no_snapshot') return <div>{label} #{st.number}: <span className="text-slate-400">状態不明（GitHub未同期）</span></div>;
  if (st.kind === 'not_in_latest') return <div>{label} #{st.number}: <span className="text-slate-400">最新30件に見つかりません</span></div>;
  const href = safeGithubUrl(st.url);
  const text = `#${st.number}`;
  return (
    <div>{label} {href ? <a className="text-sky-300 hover:underline" href={href} target="_blank" rel="noreferrer noopener">{text}</a> : text}: <Badge tone={st.merged ? 'purple' : 'slate'}>{st.label}</Badge></div>
  );
}

export default function Tasks() {
  const app = useApp();
  const { data, mode, snapshots } = app;
  const [projectId, setProjectId] = useState('');
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const [approving, setApproving] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [err, setErr] = useState('');
  const ro = mode !== 'normal';
  const tasks = data.tasks.filter((t) => !projectId || t.projectId === projectId);
  const agentName = (id?: string) => data.agents.find((a) => a.id === id)?.name;
  const projName = (id: string) => data.projects.find((p) => p.id === id)?.name ?? '?';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">タスク</h1>
        <div className="flex gap-2">
          <select aria-label="プロジェクトで絞り込み" className={`${inputCls} w-auto`} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">すべてのプロジェクト</option>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Btn tone="primary" disabled={ro || data.projects.length === 0} onClick={() => setEditing('new')}>タスクを追加</Btn>
        </div>
      </div>
      {data.projects.length === 0 && <Empty>先にプロジェクトを登録してください。</Empty>}
      {err && <p role="alert" className="text-sm text-rose-300">{err}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {STATUS_ORDER.map((s) => {
          const col = tasks.filter((t) => t.status === s);
          return (
            <div key={s} data-testid={`col-${s}`} className={`rounded-lg border-t-4 bg-slate-900/70 p-2 ${COL_TONE[s]}`}>
              <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">{STATUS_LABEL[s]}<span className="text-xs text-slate-400">{col.length}</span></h2>
              <div className="space-y-2">
                {col.map((t) => (
                  <article key={t.id} data-testid="task-card" className="rounded-md border border-slate-700 bg-slate-800 p-2 text-sm">
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-slate-400">{projName(t.projectId)} · {agentName(t.assigneeAgentId) ?? '未割り当て'}</div>
                    {(() => { const li = linkInfo(t, snapshots[t.projectId]); return (
                      <div data-testid="gh-links" className="mt-2 rounded border border-slate-700 bg-slate-900/60 p-1.5 text-xs">
                        <div className="mb-0.5 font-semibold text-slate-400">GitHubの状態</div>
                        <LinkLine label="Issue" st={li.issue} />
                        <LinkLine label="PR" st={li.pr} />
                      </div>); })()}
                    <div data-testid="owner-approval" className="mt-1 rounded border border-slate-700 bg-slate-900/60 p-1.5 text-xs">
                      <span className="font-semibold text-slate-400">家主の承認: </span>
                      {t.ownerApproved ? <span className="text-violet-300">承認済み（{fmtDateTime(t.approvedAt)}）</span> : <span className="text-slate-300">未承認</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <select aria-label={`${t.title} の状態を変更`} className="rounded border border-slate-600 bg-slate-900 px-1 py-1 text-xs" disabled={ro} value={t.status}
                        onChange={(e) => { const to = e.target.value as TaskStatus; const r = app.run((d) => moveTask(d, t.id, to, app.now())); setErr(r.ok ? '' : r.error); }}>
                        {STATUS_ORDER.filter((x) => x !== 'done' || t.status === 'done').map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
                      </select>
                      {t.status === 'awaiting_owner' && <Btn tone="ok" className="!px-2 !py-1 !text-xs" disabled={ro} onClick={() => setApproving(t)}>承認する</Btn>}
                      <Btn className="!px-2 !py-1 !text-xs" disabled={ro} onClick={() => setEditing(t)}>編集</Btn>
                      <Btn tone="danger" className="!px-2 !py-1 !text-xs" disabled={ro} onClick={() => setDeleting(t)}>削除</Btn>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {editing && <TaskForm initial={editing === 'new' ? undefined : editing} defaultProject={projectId || data.projects[0]?.id || ''} onClose={() => setEditing(null)} />}
      {approving && (
        <Confirm tone="ok" title="家主として承認しますか？" confirmLabel="承認して完了にする" onCancel={() => setApproving(null)}
          body={<><p>「{approving.title}」を承認し、完了にします。</p><p>承認はこの画面の明示的な操作でのみ記録されます。AIが代わりに承認することはありません。</p></>}
          onConfirm={() => { const r = app.run((d) => approveTask(d, approving.id, app.now())); setErr(r.ok ? '' : r.error); setApproving(null); }} />
      )}
      {deleting && (
        <Confirm title="タスクを削除しますか？" confirmLabel="削除する" onCancel={() => setDeleting(null)}
          body={<p>「{deleting.title}」を削除します。紐づく作業時間の記録は残り、タスクとの関連だけが外れます。</p>}
          onConfirm={() => { const r = app.run((d) => deleteTask(d, deleting.id)); setErr(r.ok ? '' : r.error); setDeleting(null); }} />
      )}
    </div>
  );
}
