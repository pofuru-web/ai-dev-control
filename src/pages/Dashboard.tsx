import { useApp } from '../state/AppState';
import { agentWorkload, dashboardStats, lastSyncAt, recentActivity } from '../lib/domain';
import { fmtDateTime, fmtMinutes, safeGithubUrl } from '../lib/format';
import { Badge, Card, Empty } from '../ui/kit';

function Stat({ label, value, tone, id }: { label: string; value: number; tone: string; id: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div data-testid={id} className={`mt-1 text-3xl font-bold ${tone}`}>{value}</div>
    </div>
  );
}

const kindLabel = { issue: 'Issue', pr: 'PR', commit: 'Commit' } as const;

export default function Dashboard() {
  const { data, snapshots } = useApp();
  const st = dashboardStats(data);
  const snaps = Object.values(snapshots);
  const activity = recentActivity(snaps, 10);
  const last = lastSyncAt(snaps);
  const load = agentWorkload(data);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">ダッシュボード</h1>
      {data.projects.length === 0 && <Empty>まだプロジェクトがありません。「プロジェクト」から登録してください。表示されるのはすべてこのブラウザに保存した実データで、サンプルデータはありません。</Empty>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat id="stat-projects" label="プロジェクト数" value={st.projects} tone="text-sky-300" />
        <Stat id="stat-inprogress" label="作業中タスク" value={st.inProgress} tone="text-emerald-300" />
        <Stat id="stat-awaiting" label="家主の承認待ち" value={st.awaitingOwner} tone="text-amber-300" />
        <Stat id="stat-blocked" label="ブロック中" value={st.blocked} tone="text-rose-300" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="AI担当者ごとの作業状況">
          {load.length === 0 ? <Empty>担当者が未登録です（「担当者」ページで追加）。</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-400"><tr><th className="py-1">担当者</th><th>作業中</th><th>レビュー中</th><th>ブロック</th><th>登録済み作業時間</th></tr></thead>
                <tbody>
                  {load.map((w) => (
                    <tr key={w.agent.id} className="border-t border-slate-800">
                      <td className="py-1.5">{w.agent.name}</td><td>{w.inProgress}</td><td>{w.inReview}</td><td>{w.blocked}</td><td>{fmtMinutes(w.minutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">作業時間は手入力の合計です。GitHub履歴からの推測は行いません。</p>
        </Card>
        <Card title="最近のGitHub活動" right={<span className="text-xs text-slate-400">最終同期: <span data-testid="last-sync">{fmtDateTime(last)}</span></span>}>
          {activity.length === 0 ? <Empty>GitHubデータは未取得です。「GitHub連携」で手動同期してください。</Empty> : (
            <ul className="space-y-2 text-sm">
              {activity.map((a, i) => {
                const href = safeGithubUrl(a.url);
                return (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <Badge tone={a.kind === 'pr' ? 'purple' : a.kind === 'issue' ? 'blue' : 'slate'}>{kindLabel[a.kind]}</Badge>
                    {href ? <a className="text-sky-300 hover:underline" href={href} target="_blank" rel="noreferrer noopener">{a.title}</a> : <span>{a.title}</span>}
                    <span className="text-xs text-slate-400">{a.detail} · {fmtDateTime(a.at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
