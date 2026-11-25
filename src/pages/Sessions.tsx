import { useState } from 'react';
import { useApp } from '../state/AppState';
import { PERIOD_LABEL, addSession, deleteSession, hoursBy, localDateStr, sessionDate, sessionMinutes, undatedSessionCount, updateSession, type Period, type SessionInput } from '../lib/domain';
import { fmtDateTime, fmtMinutes } from '../lib/format';
import type { WorkSession } from '../types';
import { Btn, Card, Empty, Field, Modal, inputCls } from '../ui/kit';

const toLocalInput = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function SessionFields({ v, setV, tasks, projects, agents }: { v: SessionInput; setV: (v: SessionInput) => void; tasks: { id: string; title: string }[]; projects: { id: string; name: string }[]; agents: { id: string; name: string }[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="プロジェクト"><select className={inputCls} value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value, taskId: '' })}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="担当者"><select className={inputCls} value={v.agentId} onChange={(e) => setV({ ...v, agentId: e.target.value })}>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <Field label="タスク（任意）"><select className={inputCls} value={v.taskId} onChange={(e) => setV({ ...v, taskId: e.target.value })}><option value="">指定なし</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></Field>
      <Field label="入力方法"><select className={inputCls} value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as SessionInput['mode'] })}><option value="duration">作業日＋所要時間（分）</option><option value="range">開始・終了日時</option></select></Field>
      {v.mode === 'duration' ? (<>
        <Field label="作業日" hint="空欄にすると日付なしで記録され、期間別集計（今日・今週・今月）には含まれません。"><input type="date" className={inputCls} value={v.workDate} onChange={(e) => setV({ ...v, workDate: e.target.value })} /></Field>
        <Field label="所要時間（分）"><input className={inputCls} inputMode="numeric" value={v.durationMinutes} onChange={(e) => setV({ ...v, durationMinutes: e.target.value })} /></Field>
      </>) : (<>
        <Field label="開始"><input type="datetime-local" className={inputCls} value={v.startedAt} onChange={(e) => setV({ ...v, startedAt: e.target.value })} /></Field>
        <Field label="終了"><input type="datetime-local" className={inputCls} value={v.endedAt} onChange={(e) => setV({ ...v, endedAt: e.target.value })} /></Field>
      </>)}
      <Field label="メモ（任意）"><input className={inputCls} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
    </div>
  );
}

export default function Sessions() {
  const app = useApp();
  const { data, mode } = app;
  const ro = mode !== 'normal';
  const blank = (): SessionInput => ({ projectId: data.projects[0]?.id ?? '', agentId: data.agents[0]?.id ?? '', taskId: '', mode: 'duration', startedAt: '', endedAt: '', durationMinutes: '', workDate: localDateStr(new Date()), note: '' });
  const [v, setV] = useState<SessionInput>(blank);
  const [err, setErr] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [editing, setEditing] = useState<WorkSession | null>(null);
  const [ev, setEv] = useState<SessionInput | null>(null);
  const [eerr, setEerr] = useState('');
  const pName = (id: string) => data.projects.find((p) => p.id === id)?.name ?? '?';
  const aName = (id: string) => data.agents.find((a) => a.id === id)?.name ?? '?';
  const tasksOf = (pid: string) => data.tasks.filter((t) => t.projectId === pid);
  const now = new Date();
  const byP = hoursBy(data, 'projectId', period, now);
  const byA = hoursBy(data, 'agentId', period, now);
  const undated = undatedSessionCount(data);

  const submit = () => {
    const r = app.run((d) => addSession(d, v, app.newId()));
    if (r.ok) { setErr(''); setV({ ...v, startedAt: '', endedAt: '', durationMinutes: '', note: '' }); } else setErr(r.error);
  };
  const startEdit = (w: WorkSession) => {
    setEditing(w); setEerr('');
    setEv({ projectId: w.projectId, agentId: w.agentId, taskId: w.taskId ?? '', mode: w.startedAt && w.endedAt ? 'range' : 'duration', startedAt: toLocalInput(w.startedAt), endedAt: toLocalInput(w.endedAt), durationMinutes: String(w.durationMinutes ?? ''), workDate: w.workDate ?? '', note: w.note ?? '' });
  };
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">作業時間</h1>
      <p className="rounded-md border border-slate-700 bg-slate-900/70 p-3 text-sm text-slate-300">作業時間は家主が手入力した値だけを集計します。GitHubのコミットやPRの日時から稼働時間を推測することはありません。</p>
      <Card title="作業時間を登録">
        {data.projects.length === 0 || data.agents.length === 0 ? <Empty>プロジェクトと担当者を先に登録してください。</Empty> : (
          <>
            <SessionFields v={v} setV={setV} tasks={tasksOf(v.projectId)} projects={data.projects} agents={data.agents} />
            <div className="mt-3"><Btn tone="primary" disabled={ro} onClick={submit}>登録</Btn></div>
            {err && <p role="alert" className="mt-2 text-sm text-rose-300">{err}</p>}
          </>
        )}
      </Card>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="集計期間">
        <span className="text-sm text-slate-400">集計期間:</span>
        {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
          <Btn key={p} tone={period === p ? 'primary' : 'ghost'} aria-pressed={period === p} onClick={() => setPeriod(p)}>{PERIOD_LABEL[p]}</Btn>
        ))}
      </div>
      {period !== 'all' && undated > 0 && <p className="text-xs text-slate-500">日付のない記録 {undated} 件は期間別集計に含まれません（全期間でのみ集計）。</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={`プロジェクト別合計（${PERIOD_LABEL[period]}）`}><ul className="space-y-1 text-sm" data-testid="hours-by-project">{byP.length === 0 ? <li className="text-slate-400">記録なし</li> : byP.map((x) => <li key={x.id} className="flex justify-between"><span>{pName(x.id)}</span><span>{fmtMinutes(x.minutes)}</span></li>)}</ul></Card>
        <Card title={`担当者別合計（${PERIOD_LABEL[period]}）`}><ul className="space-y-1 text-sm" data-testid="hours-by-agent">{byA.length === 0 ? <li className="text-slate-400">記録なし</li> : byA.map((x) => <li key={x.id} className="flex justify-between"><span>{aName(x.id)}</span><span>{fmtMinutes(x.minutes)}</span></li>)}</ul></Card>
      </div>
      <Card title="記録一覧">
        {data.workSessions.length === 0 ? <Empty>記録がありません。</Empty> : (
          <ul className="space-y-2 text-sm">
            {[...data.workSessions].reverse().map((w) => (
              <li key={w.id} data-testid="session-row" className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2">
                <span>{pName(w.projectId)} · {aName(w.agentId)} · {fmtMinutes(sessionMinutes(w))}{w.startedAt ? `（${fmtDateTime(w.startedAt)} 〜 ${fmtDateTime(w.endedAt)}）` : `（${sessionDate(w) ?? '日付なし'}）`}{w.note ? ` — ${w.note}` : ''}</span>
                <span className="flex gap-2">
                  <Btn disabled={ro} onClick={() => startEdit(w)}>編集</Btn>
                  <Btn tone="danger" disabled={ro} onClick={() => { const r = app.run((d) => deleteSession(d, w.id)); setErr(r.ok ? '' : r.error); }}>削除</Btn>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && ev && (
        <Modal title="作業時間を編集" onClose={() => setEditing(null)}>
          <SessionFields v={ev} setV={setEv} tasks={tasksOf(ev.projectId)} projects={data.projects} agents={data.agents} />
          {eerr && <p role="alert" className="mt-2 text-sm text-rose-300">{eerr}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Btn onClick={() => setEditing(null)}>キャンセル</Btn>
            <Btn tone="primary" onClick={() => { const r = app.run((d) => updateSession(d, editing.id, ev)); if (r.ok) setEditing(null); else setEerr(r.error); }}>保存</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
