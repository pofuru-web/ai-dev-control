import { useState } from 'react';
import { useApp } from '../state/AppState';
import { addSession, deleteSession, hoursBy, sessionMinutes, type SessionInput } from '../lib/domain';
import { fmtDateTime, fmtMinutes } from '../lib/format';
import { Btn, Card, Empty, Field, inputCls } from '../ui/kit';

export default function Sessions() {
  const app = useApp();
  const { data, mode } = app;
  const ro = mode !== 'normal';
  const blank: SessionInput = { projectId: data.projects[0]?.id ?? '', agentId: data.agents[0]?.id ?? '', taskId: '', mode: 'duration', startedAt: '', endedAt: '', durationMinutes: '', note: '' };
  const [v, setV] = useState<SessionInput>(blank);
  const [err, setErr] = useState('');
  const tasksOf = data.tasks.filter((t) => t.projectId === v.projectId);
  const pName = (id: string) => data.projects.find((p) => p.id === id)?.name ?? '?';
  const aName = (id: string) => data.agents.find((a) => a.id === id)?.name ?? '?';
  const submit = () => {
    const r = app.run((d) => addSession(d, v, app.newId()));
    if (r.ok) { setErr(''); setV({ ...v, startedAt: '', endedAt: '', durationMinutes: '', note: '' }); } else setErr(r.error);
  };
  const byP = hoursBy(data, 'projectId');
  const byA = hoursBy(data, 'agentId');
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">作業時間</h1>
      <p className="rounded-md border border-slate-700 bg-slate-900/70 p-3 text-sm text-slate-300">作業時間は家主が手入力した値だけを集計します。GitHubのコミットやPRの日時から稼働時間を推測することはありません。</p>
      <Card title="作業時間を登録">
        {data.projects.length === 0 || data.agents.length === 0 ? <Empty>プロジェクトと担当者を先に登録してください。</Empty> : (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="プロジェクト"><select className={inputCls} value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value, taskId: '' })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="担当者"><select className={inputCls} value={v.agentId} onChange={(e) => setV({ ...v, agentId: e.target.value })}>{data.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label="タスク（任意）"><select className={inputCls} value={v.taskId} onChange={(e) => setV({ ...v, taskId: e.target.value })}><option value="">指定なし</option>{tasksOf.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></Field>
            <Field label="入力方法"><select className={inputCls} value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as SessionInput['mode'] })}><option value="duration">所要時間（分）のみ</option><option value="range">開始・終了日時</option></select></Field>
            {v.mode === 'duration' ? (
              <Field label="所要時間（分）"><input className={inputCls} inputMode="numeric" value={v.durationMinutes} onChange={(e) => setV({ ...v, durationMinutes: e.target.value })} /></Field>
            ) : (<>
              <Field label="開始"><input type="datetime-local" className={inputCls} value={v.startedAt} onChange={(e) => setV({ ...v, startedAt: e.target.value })} /></Field>
              <Field label="終了"><input type="datetime-local" className={inputCls} value={v.endedAt} onChange={(e) => setV({ ...v, endedAt: e.target.value })} /></Field>
            </>)}
            <Field label="メモ（任意）"><input className={inputCls} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
            <div className="flex items-end"><Btn tone="primary" disabled={ro} onClick={submit}>登録</Btn></div>
            {err && <p role="alert" className="text-sm text-rose-300 md:col-span-2">{err}</p>}
          </div>
        )}
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="プロジェクト別合計"><ul className="space-y-1 text-sm" data-testid="hours-by-project">{byP.length === 0 ? <li className="text-slate-400">記録なし</li> : byP.map((x) => <li key={x.id} className="flex justify-between"><span>{pName(x.id)}</span><span>{fmtMinutes(x.minutes)}</span></li>)}</ul></Card>
        <Card title="担当者別合計"><ul className="space-y-1 text-sm" data-testid="hours-by-agent">{byA.length === 0 ? <li className="text-slate-400">記録なし</li> : byA.map((x) => <li key={x.id} className="flex justify-between"><span>{aName(x.id)}</span><span>{fmtMinutes(x.minutes)}</span></li>)}</ul></Card>
      </div>
      <Card title="記録一覧">
        {data.workSessions.length === 0 ? <Empty>記録がありません。</Empty> : (
          <ul className="space-y-2 text-sm">
            {[...data.workSessions].reverse().map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2">
                <span>{pName(w.projectId)} · {aName(w.agentId)} · {fmtMinutes(sessionMinutes(w))}{w.startedAt ? `（${fmtDateTime(w.startedAt)} 〜 ${fmtDateTime(w.endedAt)}）` : '（日時なし）'}{w.note ? ` — ${w.note}` : ''}</span>
                <Btn tone="danger" disabled={ro} onClick={() => { const r = app.run((d) => deleteSession(d, w.id)); setErr(r.ok ? '' : r.error); }}>削除</Btn>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
