import { useRef, useState } from 'react';
import { useApp } from '../state/AppState';
import type { LocalData } from '../types';
import { Banner, Btn, Card, Confirm } from '../ui/kit';

const counts = (d: LocalData) => `プロジェクト ${d.projects.length} / 担当者 ${d.agents.length} / タスク ${d.tasks.length} / 作業時間 ${d.workSessions.length}`;

export default function DataView() {
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<LocalData | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [fresh, setFresh] = useState(false);
  const canRestore = app.mode !== 'newer_schema';

  const download = () => {
    const blob = new Blob([app.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ai-dev-control-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg({ tone: 'info', text: 'バックアップをダウンロードしました。' });
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = app.importJson(await f.text());
    if (r.ok) { setPending(r.data); setMsg(null); } else setMsg({ tone: 'error', text: `復元できません: ${r.error}（現在のデータは変更されていません）` });
    if (fileRef.current) fileRef.current.value = '';
  };
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">データ管理</h1>
      <Card title="保存場所">
        <p className="text-sm text-slate-300">データはこのブラウザの localStorage にのみ保存されます（サーバーには送信しません）。{app.persistent ? '' : '現在このブラウザの保存領域が使えないため、タブを閉じると失われます。'}</p>
        <p className="mt-1 text-sm text-slate-400">現在: {counts(app.data)}</p>
        <p className="mt-1 text-xs text-slate-500">バックアップにはGitHubから取得したデータは含まれません（再同期で取得できます）。</p>
      </Card>
      {msg && <Banner tone={msg.tone} title={msg.text} />}
      <Card title="バックアップ（ダウンロード）">
        <Btn tone="primary" onClick={download}>JSONをダウンロード</Btn>
      </Card>
      <Card title="バックアップから復元">
        <input ref={fileRef} data-testid="restore-input" type="file" accept="application/json,.json" disabled={!canRestore} onChange={(e) => void onFile(e.target.files?.[0])} className="text-sm" />
        <p className="mt-2 text-xs text-slate-500">{canRestore ? 'ファイルを選ぶと内容を検証し、確認画面で現在のデータとの差を表示します。確認するまで何も変更されません。' : '新しいバージョンのデータが保存されているため、復元は無効です。'}</p>
      </Card>
      {app.mode === 'corrupt' && (
        <Card title="破損データの扱い">
          <p className="text-sm text-slate-300">保存データを読み込めませんでした。バックアップから復元するか、空の状態から開始してください。</p>
          <Btn className="mt-2" tone="danger" onClick={() => setFresh(true)}>空の状態で開始する</Btn>
        </Card>
      )}
      {pending && (
        <Confirm title="この内容で復元しますか？" confirmLabel="復元する" onCancel={() => setPending(null)}
          body={<><p>現在のデータは置き換えられます。</p><p>現在: {counts(app.data)}</p><p>復元後: {counts(pending)}</p><p className="text-xs text-slate-400">直前の世代は自動的に退避されますが、念のため先にバックアップをダウンロードしてください。</p></>}
          onConfirm={() => { const r = app.applyImport(pending); setPending(null); setMsg(r.ok ? { tone: 'info', text: '復元しました。' } : { tone: 'error', text: r.error }); }} />
      )}
      {fresh && (
        <Confirm title="空の状態で開始しますか？" confirmLabel="開始する" onCancel={() => setFresh(false)}
          body={<p>破損した保存データを空のデータで置き換えます。元に戻せません。</p>}
          onConfirm={() => { const r = app.startFresh(); setFresh(false); setMsg(r.ok ? { tone: 'info', text: '空の状態で開始しました。' } : { tone: 'error', text: r.error }); }} />
      )}
    </div>
  );
}
