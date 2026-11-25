import { useState } from 'react';
import { useApp } from '../state/AppState';
import { addAgent, deleteAgent } from '../lib/domain';
import type { Agent } from '../types';
import { Btn, Card, Empty, Field, inputCls } from '../ui/kit';

const KIND: Record<Agent['kind'], string> = { 'claude-code-web': 'Claude Code Web', 'codex-cloud': 'Codex Cloud', human: '人間', other: 'その他' };
const ROLE: Record<Agent['role'], string> = { developer: '開発', reviewer: 'レビュー' };

export default function Agents() {
  const app = useApp();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Agent['kind']>('claude-code-web');
  const [role, setRole] = useState<Agent['role']>('developer');
  const [err, setErr] = useState('');
  const ro = app.mode !== 'normal';
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">担当者</h1>
      <Card title="担当者を追加">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="名前"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="種別"><select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as Agent['kind'])}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="役割"><select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as Agent['role'])}>{Object.entries(ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <div className="flex items-end"><Btn tone="primary" disabled={ro} onClick={() => { const r = app.run((d) => addAgent(d, { name, kind, role }, app.newId())); if (r.ok) { setName(''); setErr(''); } else setErr(r.error); }}>追加</Btn></div>
        </div>
        {err && <p role="alert" className="mt-2 text-sm text-rose-300">{err}</p>}
      </Card>
      {app.data.agents.length === 0 ? <Empty>担当者が未登録です。</Empty> : (
        <ul className="space-y-2">
          {app.data.agents.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-900/70 px-4 py-2 text-sm">
              <span data-testid="agent-name">{a.name} <span className="text-slate-400">（{KIND[a.kind]} / {ROLE[a.role]}）</span></span>
              <Btn tone="danger" disabled={ro} onClick={() => { const r = app.run((d) => deleteAgent(d, a.id)); setErr(r.ok ? '' : r.error); }}>削除</Btn>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
