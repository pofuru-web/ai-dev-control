import { useState } from 'react';
import { useApp } from '../state/AppState';
import { addAgent, deleteAgent, updateAgent, type AgentInput } from '../lib/domain';
import { KIND_LABEL, ROLE_LABEL, ROLE_ORDER, SELECTABLE_KINDS } from '../lib/labels';
import type { Agent, AgentKind, AgentRole } from '../types';
import { Badge, Btn, Card, Confirm, Empty, Field, Modal, inputCls } from '../ui/kit';

function AgentFields({ v, setV }: { v: AgentInput; setV: (v: AgentInput) => void }) {
  const kinds: AgentKind[] = SELECTABLE_KINDS.includes(v.kind) ? SELECTABLE_KINDS : [...SELECTABLE_KINDS, v.kind];
  return (
    <div className="space-y-3">
      <Field label="名前"><input className={inputCls} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      <Field label="種別">
        <select className={inputCls} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as AgentKind })}>
          {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </Field>
      <fieldset>
        <legend className="mb-1 text-sm text-slate-300">役割（複数選択可）</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {ROLE_ORDER.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v.roles.includes(r)} onChange={(e) => setV({ ...v, roles: e.target.checked ? [...v.roles, r] : v.roles.filter((x) => x !== r) })} />
              {ROLE_LABEL[r]}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function EditAgent({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const app = useApp();
  const [v, setV] = useState<AgentInput>({ name: agent.name, kind: agent.kind, roles: agent.roles });
  const [err, setErr] = useState('');
  return (
    <Modal title="担当者を編集" onClose={onClose}>
      <AgentFields v={v} setV={setV} />
      <p className="mt-2 text-xs text-slate-500">担当者ID は変わらないため、既存のタスク・作業時間との紐付けは維持されます。</p>
      {err && <p role="alert" className="mt-2 text-sm text-rose-300">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Btn onClick={onClose}>キャンセル</Btn>
        <Btn tone="primary" onClick={() => { const r = app.run((d) => updateAgent(d, agent.id, v)); if (r.ok) onClose(); else setErr(r.error); }}>保存</Btn>
      </div>
    </Modal>
  );
}

export default function Agents() {
  const app = useApp();
  const [v, setV] = useState<AgentInput>({ name: '', kind: 'claude-code-web', roles: ['developer'] });
  const [editing, setEditing] = useState<Agent | null>(null);
  const [deleting, setDeleting] = useState<Agent | null>(null);
  const [err, setErr] = useState('');
  const ro = app.mode !== 'normal';
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">担当者</h1>
      <Card title="担当者を追加">
        <AgentFields v={v} setV={setV} />
        <div className="mt-3"><Btn tone="primary" disabled={ro} onClick={() => { const r = app.run((d) => addAgent(d, v, app.newId())); if (r.ok) { setV({ ...v, name: '' }); setErr(''); } else setErr(r.error); }}>追加</Btn></div>
        {err && <p role="alert" className="mt-2 text-sm text-rose-300">{err}</p>}
      </Card>
      {app.data.agents.length === 0 ? <Empty>担当者が未登録です。</Empty> : (
        <ul className="space-y-2">
          {app.data.agents.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-900/70 px-4 py-2 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                <span data-testid="agent-name" className="font-medium">{a.name}</span>
                <Badge tone="blue">{KIND_LABEL[a.kind]}</Badge>
                {a.roles.map((r) => <Badge key={r}>{ROLE_LABEL[r as AgentRole]}</Badge>)}
              </span>
              <span className="flex gap-2">
                <Btn disabled={ro} onClick={() => setEditing(a)}>編集</Btn>
                <Btn tone="danger" disabled={ro} onClick={() => setDeleting(a)}>削除</Btn>
              </span>
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <Confirm title="担当者を削除しますか？" confirmLabel="削除する" onCancel={() => setDeleting(null)}
          body={<><p>「{deleting.name}」を削除します。</p><p>担当しているタスク {app.data.tasks.filter((t) => t.assigneeAgentId === deleting.id).length} 件は「未割り当て」になります。作業時間の記録がある担当者は削除できません。</p></>}
          onConfirm={() => { const r = app.run((d) => deleteAgent(d, deleting.id)); setErr(r.ok ? '' : r.error); setDeleting(null); }} />
      )}
      {editing && <EditAgent agent={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
