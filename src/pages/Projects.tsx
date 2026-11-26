import { useState } from 'react';
import { useApp } from '../state/AppState';
import { addProject, projectDeletionImpact, deleteProject, repoChangeImpact, updateProject, type ProjectInput } from '../lib/domain';
import { fmtDateTime } from '../lib/format';
import type { Project } from '../types';
import { Badge, Btn, Card, Confirm, Empty, Field, Modal, inputCls } from '../ui/kit';

const STATUS: Record<Project['status'], string> = { active: '進行中', paused: '一時停止', done: '完了' };

function ProjectForm({ initial, onClose }: { initial?: Project; onClose: () => void }) {
  const app = useApp();
  const [v, setV] = useState<ProjectInput>({
    name: initial?.name ?? '', description: initial?.description ?? '', status: initial?.status ?? 'active',
    repoText: initial?.repo ? `${initial.repo.owner}/${initial.repo.name}` : '',
  });
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<{ tasksWithLinks: number; approvedRevoked: number } | null>(null);
  const save = () => {
    const now = app.now();
    const r = app.run((d) => (initial ? updateProject(d, initial.id, v, now) : addProject(d, v, app.newId(), now)));
    if (r.ok) onClose(); else { setError(r.error); setConfirm(null); }
  };
  const submit = () => {
    let impact: ReturnType<typeof repoChangeImpact> | undefined;
    try { impact = initial ? repoChangeImpact(app.data, initial.id, v) : undefined; } catch { impact = undefined; /* input errors surface from save() */ }
    if (impact?.repoChanged && impact.tasksWithLinks > 0) setConfirm(impact); else save();
  };
  return (
    <Modal title={initial ? 'プロジェクトを編集' : 'プロジェクトを登録'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="プロジェクト名"><input className={inputCls} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="説明（任意）"><textarea className={inputCls} rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <Field label="GitHubリポジトリ（任意・公開リポジトリのみ）" hint="例: pofuru-web/ai-dev-lab-public。読み取り専用で参照します。">
          <input className={inputCls} value={v.repoText} onChange={(e) => setV({ ...v, repoText: e.target.value })} placeholder="owner/name" />
        </Field>
        <Field label="状態">
          <select className={inputCls} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as Project['status'] })}>
            {Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        <div className="flex justify-end gap-2"><Btn onClick={onClose}>キャンセル</Btn><Btn tone="primary" onClick={submit}>保存</Btn></div>
      </div>
      {confirm && (
        <Confirm title="リポジトリを変更しますか？" confirmLabel="Issue/PRの紐付けを解除して変更" onCancel={() => setConfirm(null)}
          body={<>
            <p data-testid="repo-change-impact">影響するタスク: <strong>{confirm.tasksWithLinks} 件</strong>（Issue/PR番号を手入力で紐付けているもの）</p>
            <p>リポジトリを変更すると、これらのタスクの Issue/PR の紐付けが<strong>すべて解除</strong>されます（旧リポジトリの番号は引き継ぎません）。同期済みの旧リポジトリのGitHubデータも破棄されます。</p>
            {confirm.approvedRevoked > 0 && <p className="text-amber-300">うち家主承認済みの {confirm.approvedRevoked} 件は、紐付けが変わるため承認が取り消され、「承認待ち」に戻ります（再承認が必要）。</p>}
            <p className="text-xs text-slate-400">キャンセルすると何も変更されません。大文字・小文字だけの違いは同じリポジトリとして扱い、解除しません。</p>
          </>}
          onConfirm={save} />
      )}
    </Modal>
  );
}

export default function Projects() {
  const app = useApp();
  const { data, mode, sync, snapshots } = app;
  const [editing, setEditing] = useState<Project | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [err, setErr] = useState('');
  const ro = mode !== 'normal';
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">プロジェクト</h1>
        <Btn tone="primary" disabled={ro} onClick={() => setEditing('new')}>プロジェクトを登録</Btn>
      </div>
      {err && <p role="alert" className="text-sm text-rose-300">{err}</p>}
      {data.projects.length === 0 ? <Empty>プロジェクトが未登録です。</Empty> : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.projects.map((p) => {
            const s = sync[p.id]?.status ?? 'idle';
            return (
              <Card key={p.id}>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-semibold" data-testid="project-name">{p.name}</h2>
                  <Badge tone={p.status === 'active' ? 'green' : p.status === 'paused' ? 'amber' : 'slate'}>{STATUS[p.status]}</Badge>
                </div>
                {p.description && <p className="mt-1 text-sm text-slate-400">{p.description}</p>}
                <p className="mt-2 text-sm text-slate-300">GitHub: {p.repo ? `${p.repo.owner}/${p.repo.name}` : '未設定'}</p>
                <p className="text-xs text-slate-500">最終同期: {fmtDateTime(snapshots[p.id]?.fetchedAt)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Btn disabled={!p.repo || s === 'syncing'} onClick={() => void app.syncProject(p.id)}>{s === 'syncing' ? '同期中…' : 'GitHub同期（手動）'}</Btn>
                  <Btn disabled={ro} onClick={() => setEditing(p)}>編集</Btn>
                  <Btn tone="danger" disabled={ro} onClick={() => setDeleting(p)}>削除</Btn>
                </div>
                {s === 'failed' && <p className="mt-2 text-xs text-rose-300">同期に失敗しました。詳細は「GitHub連携」で確認できます（旧データは保持）。</p>}
              </Card>
            );
          })}
        </div>
      )}
      {editing && <ProjectForm initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {deleting && (() => {
        const impact = projectDeletionImpact(data, deleting.id);
        return (
          <Confirm title="プロジェクトを削除しますか？" confirmLabel="削除する" onCancel={() => setDeleting(null)}
            body={<><p>「{deleting.name}」を削除します。関連するタスク {impact.tasks} 件・作業時間 {impact.sessions} 件も削除されます。</p><p>この操作は元に戻せません。事前にバックアップをおすすめします。</p></>}
            onConfirm={() => { const r = app.run((d) => deleteProject(d, deleting.id)); if (!r.ok) setErr(r.error); setDeleting(null); }} />
        );
      })()}
    </div>
  );
}
