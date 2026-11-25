import { useEffect, useState } from 'react';
import { AppProvider, useApp } from './state/AppState';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import Tasks from './pages/Tasks';
import Sessions from './pages/Sessions';
import GitHubView from './pages/GitHubView';
import Agents from './pages/Agents';
import DataView from './pages/DataView';
import { Banner, Btn } from './ui/kit';

const PAGES = [
  { id: 'dashboard', label: 'ダッシュボード', C: Dashboard },
  { id: 'projects', label: 'プロジェクト', C: Projects },
  { id: 'tasks', label: 'タスク', C: Tasks },
  { id: 'sessions', label: '作業時間', C: Sessions },
  { id: 'github', label: 'GitHub連携', C: GitHubView },
  { id: 'agents', label: '担当者', C: Agents },
  { id: 'data', label: 'データ管理', C: DataView },
] as const;
type PageId = (typeof PAGES)[number]['id'];

const fromHash = (): PageId => PAGES.find((p) => p.id === window.location.hash.slice(1))?.id ?? 'dashboard';

function Notices({ go }: { go: (p: PageId) => void }) {
  const app = useApp();
  const toData = <Btn onClick={() => go('data')}>データ管理を開く</Btn>;
  return (
    <div className="space-y-2">
      {app.mode === 'newer_schema' && (
        <Banner tone="warn" title="読み取り専用モード">
          <p>保存されているデータは新しいバージョン（schemaVersion {app.loadInfo.foundVersion}）のアプリで作成されています。データ保護のため、編集・保存・復元はできません。アプリを最新版に更新してください。</p>
        </Banner>
      )}
      {app.mode === 'corrupt' && (
        <Banner tone="error" title="保存データを読み込めませんでした" actions={toData}>
          <p>データは変更していません。バックアップから復元するか、空の状態で開始してください（それまで編集は無効です）。</p>
        </Banner>
      )}
      {app.mode === 'stale' && (
        <Banner tone="error" title="このタブのデータは古くなっています" actions={<><Btn tone="primary" onClick={() => window.location.reload()}>最新のデータを読み込む</Btn>{toData}</>}>
          <p data-testid="stale-reason">{app.staleReason}</p>
          <p>上書きを防ぐため、このタブでは編集・保存を止めています。まず「最新のデータを読み込む」で再読み込みしてください。このタブで直前に入力した内容は保存されていません。必要ならその前に「データ管理」でバックアップをダウンロードできます（このタブが保持している古い内容になります）。</p>
        </Banner>
      )}
      {app.loadInfo.migrationFailed && (
        <Banner tone="error" title="旧形式のデータを新形式に変換できませんでした" actions={toData}>
          <p>元のデータは一切変更していません（{app.loadInfo.migrationFailed.error}）。「データ管理」から元データをダウンロードして保管してください。</p>
        </Banner>
      )}
      {app.loadInfo.migratedFrom !== undefined && app.mode === 'normal' && (
        <Banner tone="info" title="旧形式のデータを新形式に変換して表示しています">
          <p>変換はまだ保存されていません。最初に保存するとき、変換前の元データを別の場所に控えてから保存します。</p>
        </Banner>
      )}
      {app.loadInfo.recoveredFromPrev && (
        <Banner tone="warn" title="直前の世代のデータから復旧しました">
          <p>最新の保存データが読めなかったため、ひとつ前の保存内容を表示しています。直近の変更が含まれていない可能性があります。</p>
        </Banner>
      )}
      {!app.persistent && <Banner tone="warn" title="ブラウザの保存領域が使えません"><p>このタブを閉じるとデータが失われます。こまめにバックアップをダウンロードしてください。</p></Banner>}
      {app.saveProblem && (
        <Banner tone="error" title="保存できませんでした" actions={<>{toData}<Btn onClick={app.dismissSaveProblem}>閉じる</Btn></>}>
          <p data-testid="save-problem">{app.saveProblem.message}</p>
          {app.saveProblem.recovery && <p data-testid="save-recovery">{app.saveProblem.recovery}</p>}
        </Banner>
      )}
    </div>
  );
}

function Shell() {
  const [page, setPage] = useState<PageId>(fromHash);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setPage(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (p: PageId) => { window.history.pushState(null, "", `#${p}`); setPage(p); setOpen(false); };
  const Current = PAGES.find((p) => p.id === page)!.C;
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 md:flex">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3 md:hidden">
        <span className="font-bold tracking-wide">AI Dev Control</span>
        <Btn aria-expanded={open} aria-controls="nav" onClick={() => setOpen(!open)}>メニュー</Btn>
      </header>
      <nav id="nav" aria-label="メインナビゲーション" className={`${open ? 'block' : 'hidden'} border-b border-slate-800 bg-slate-900 p-3 md:block md:min-h-screen md:w-56 md:shrink-0 md:border-b-0 md:border-r`}>
        <div className="mb-4 hidden px-2 md:block">
          <div className="text-lg font-bold tracking-wide text-sky-300">AI Dev Control</div>
          <div className="text-xs text-slate-500">開発管制室</div>
        </div>
        <ul className="space-y-1">
          {PAGES.map((p) => (
            <li key={p.id}>
              <a href={`#${p.id}`} aria-current={page === p.id ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go(p.id); }}
                className={`block rounded-md px-3 py-2 text-sm ${page === p.id ? 'bg-sky-900 font-semibold text-sky-100' : 'text-slate-300 hover:bg-slate-800'}`}>{p.label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <main className="min-w-0 flex-1 space-y-4 p-4 md:p-6">
        <Notices go={go} />
        <Current />
      </main>
    </div>
  );
}

export default function App() {
  return <AppProvider><Shell /></AppProvider>;
}
