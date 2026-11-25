import { useState } from 'react';
import { useApp } from '../state/AppState';
import { ERROR_TEXT, fmtDateTime, safeGithubUrl } from '../lib/format';
import { Badge, Banner, Btn, Card, Empty, inputCls } from '../ui/kit';

function Ext({ href, children }: { href: string; children: string }) {
  const h = safeGithubUrl(href);
  return h ? <a className="text-sky-300 hover:underline" href={h} target="_blank" rel="noreferrer noopener">{children}</a> : <span>{children}</span>;
}

export default function GitHubView() {
  const app = useApp();
  const withRepo = app.data.projects.filter((p) => p.repo);
  const [sel, setSel] = useState('');
  const project = withRepo.find((p) => p.id === sel) ?? withRepo[0];
  if (!project) return (
    <div className="space-y-4"><h1 className="text-xl font-bold">GitHub連携</h1><Empty>GitHubリポジトリを設定したプロジェクトがありません。「プロジェクト」で設定してください。</Empty></div>
  );
  const snap = app.snapshots[project.id];
  const st = app.sync[project.id] ?? { status: 'idle' as const };
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">GitHub連携</h1>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="プロジェクト" className={`${inputCls} w-auto`} value={project.id} onChange={(e) => setSel(e.target.value)}>
          {withRepo.map((p) => <option key={p.id} value={p.id}>{p.name}（{p.repo!.owner}/{p.repo!.name}）</option>)}
        </select>
        <Btn tone="primary" disabled={st.status === 'syncing'} onClick={() => void app.syncProject(project.id)}>{st.status === 'syncing' ? '同期中…' : '手動で同期'}</Btn>
        <span data-testid="sync-status" className="text-sm text-slate-300">
          {st.status === 'syncing' ? '同期中' : st.status === 'failed' ? '同期失敗' : snap ? '同期済み' : '未取得'}
        </span>
      </div>
      <p className="text-xs text-slate-500">GitHubへは読み取り（GET）のみ行います。自動同期はありません。</p>
      {st.status === 'failed' && st.error && (
        <Banner tone="error" title="同期に失敗しました">
          <p data-testid="sync-error">{ERROR_TEXT[st.error.code] ?? st.error.message}{st.error.resetAt ? `（リセット: ${fmtDateTime(st.error.resetAt)}）` : ''}</p>
          <p>{snap ? `前回取得したデータ（${fmtDateTime(snap.fetchedAt)}）をそのまま表示しています。データは消去されていません。` : '保存済みのデータはありません。'}</p>
        </Banner>
      )}
      {!snap ? <Empty>まだデータを取得していません。</Empty> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card><div className="text-xs text-slate-400">最終取得日時</div><div data-testid="fetched-at" className="font-medium">{fmtDateTime(snap.fetchedAt)}</div></Card>
            <Card><div className="text-xs text-slate-400">API残量（取得時点）</div><div data-testid="rate-limit" className="font-medium">{snap.rateLimit ? `${snap.rateLimit.remaining} / ${snap.rateLimit.limit}` : '不明'}</div>{snap.rateLimit && <div className="text-xs text-slate-500">リセット {fmtDateTime(snap.rateLimit.resetAt)}</div>}</Card>
            <Card><div className="text-xs text-slate-400">取得件数</div><div className="font-medium">Issue {snap.issues.length} / PR {snap.pulls.length} / Commit {snap.commits.length}</div></Card>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card title="Issue（最新30件まで）"><ul className="space-y-2 text-sm" data-testid="issue-list">{snap.issues.length === 0 ? <li className="text-slate-400">なし</li> : snap.issues.map((i) => <li key={i.number}><Badge tone={i.state === 'open' ? 'green' : 'slate'}>{i.state === 'open' ? 'オープン' : 'クローズ'}</Badge> <Ext href={i.url}>{`#${i.number} ${i.title}`}</Ext><div className="text-xs text-slate-500">{i.author || '不明'} · {fmtDateTime(i.createdAt)}</div></li>)}</ul></Card>
            <Card title="Pull Request（最新30件まで）"><ul className="space-y-2 text-sm" data-testid="pr-list">{snap.pulls.length === 0 ? <li className="text-slate-400">なし</li> : snap.pulls.map((p) => <li key={p.number}>{p.merged ? <Badge tone="purple">マージ済み</Badge> : p.state === 'open' ? <Badge tone="green">オープン</Badge> : <Badge tone="amber">クローズ（未マージ）</Badge>} <Ext href={p.url}>{`#${p.number} ${p.title}`}</Ext><div className="text-xs text-slate-500">{p.head} → {p.base} · {p.merged ? `マージ ${fmtDateTime(p.mergedAt)}` : fmtDateTime(p.createdAt)}</div></li>)}</ul></Card>
            <Card title="Commit（最新30件まで）"><ul className="space-y-2 text-sm" data-testid="commit-list">{snap.commits.length === 0 ? <li className="text-slate-400">なし</li> : snap.commits.map((c) => <li key={c.sha}><code className="text-xs text-slate-400">{c.sha.slice(0, 7)}</code> <Ext href={c.url}>{c.message.split('\n')[0] ?? ''}</Ext><div className="text-xs text-slate-500">{c.author} · {fmtDateTime(c.committedAt)}</div></li>)}</ul></Card>
          </div>
        </>
      )}
    </div>
  );
}
