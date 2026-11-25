import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GitHubSnapshot, Id, LocalData, SnapshotError } from '../types';
import { LOCAL_KEY, loadLocal, loadSnapshot, saveLocal, snapshotKey, type KV, type SaveResult } from '../lib/storage';
import { emptyLocalData, isLocalData, isSnapshot } from '../lib/validate';
import { refreshSnapshot } from '../lib/github/client';
import { parseBackup, exportBackup } from '../lib/backup';
import * as D from '../lib/domain';

/**
 * normal: editable. newer_schema / corrupt: read-only (see banners). stale: another tab or window saved newer data,
 * so this tab's copy is out of date and editing is blocked until it is reloaded.
 */
export type Mode = 'normal' | 'newer_schema' | 'corrupt' | 'stale';
export type SyncState = { status: 'idle' | 'syncing' | 'failed'; error?: SnapshotError };
export type Result = { ok: true } | { ok: false; error: string };

class MemoryKV implements KV {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

function pickKv(): { kv: KV; persistent: boolean } {
  try {
    const t = '__adc_probe__';
    window.localStorage.setItem(t, '1');
    window.localStorage.removeItem(t);
    return { kv: window.localStorage, persistent: true };
  } catch {
    return { kv: new MemoryKV(), persistent: false };
  }
}

export interface SaveProblem { message: string; recovery?: string; refusal?: string }

export function describeSaveFailure(r: Extract<SaveResult, { ok: false }>): SaveProblem {
  if (r.kind === 'newer_schema') return { message: '保存先のデータは新しいバージョンで作成されているため、上書きを拒否しました。', refusal: 'newer_schema' };
  if (r.kind === 'read_failed') return { message: '既存データを読み取れなかったため、データ保護のため保存を中止しました。変更は反映されていません。', refusal: 'read_failed' };
  if (r.kind === 'conflict') return { message: '他のタブまたはウィンドウでデータが更新されていたため、上書きを防ぐ目的で保存を中止しました。この変更は保存されていません。', refusal: 'conflict' };
  if (r.kind === 'migration_backup_failed') return { message: '旧形式のデータの控えを保存できなかったため、データ保護のため保存を中止しました。変更は反映されていません。', refusal: 'migration_backup_failed' };
  const rec = r.recovery === 'restored_previous' ? '直前のデータを書き戻して検証済みです。'
    : r.recovery === 'removed_new' ? '検証できなかった新しいデータは削除しました。'
    : r.recovery === 'restore_failed' ? '直前のデータへの復旧にも失敗しました。画面のデータは失われていません。すぐに「データ管理」からバックアップをダウンロードしてください。'
    : '直前のデータは保持されています。';
  return { message: `保存に失敗しました（${r.error}）。`, recovery: rec };
}

const matchesProject = (data: LocalData, id: Id, snap: GitHubSnapshot) => D.staleSnapshotIds(data.projects, { [id]: snap }).length === 0;

function init() {
  const { kv, persistent } = pickKv();
  const loaded = loadLocal(kv);
  const mode: Mode = loaded.status === 'readonly_newer_schema' ? 'newer_schema' : loaded.status === 'corrupt' || loaded.status === 'migration_failed' ? 'corrupt' : 'normal';
  const snaps: Record<Id, GitHubSnapshot> = {};
  for (const p of loaded.data.projects) {
    const s = loadSnapshot(kv, p.id);
    if (s && matchesProject(loaded.data, p.id, s)) snaps[p.id] = s; // a cache for another repository is never shown
  }
  return { kv, persistent, loaded, mode, snaps };
}

export interface LoadInfo {
  recoveredFromPrev: boolean;
  migratedFrom?: number;
  migrationFailed?: { fromVersion: number; error: string };
  foundVersion?: number;
  problems?: string[];
}

export interface AppApi {
  data: LocalData;
  mode: Mode;
  staleReason: string | null;
  persistent: boolean;
  loadInfo: LoadInfo;
  saveProblem: SaveProblem | null;
  dismissSaveProblem(): void;
  snapshots: Record<Id, GitHubSnapshot>;
  sync: Record<Id, SyncState>;
  syncProject(projectId: Id): Promise<void>;
  run(op: (d: LocalData) => LocalData): Result;
  newId(): Id;
  now(): string;
  exportJson(): string;
  /** The stored value exactly as it is in localStorage (for rescue when it cannot be loaded). */
  rawStored(): string | null;
  importJson(text: string): { ok: true; data: LocalData } | { ok: false; error: string };
  applyImport(data: LocalData): Result;
  startFresh(): Result;
}

const Ctx = createContext<AppApi | null>(null);
export const useApp = (): AppApi => {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider missing');
  return v;
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [boot] = useState(init);
  const [data, setData] = useState<LocalData>(boot.loaded.data);
  const [mode, setMode] = useState<Mode>(boot.mode);
  const [staleReason, setStaleReason] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState(boot.snaps);
  const [sync, setSync] = useState<Record<Id, SyncState>>({});
  const [saveProblem, setSaveProblem] = useState<SaveProblem | null>(null);
  const dataRef = useRef(data);
  const modeRef = useRef(mode);
  const snapsRef = useRef(snapshots);
  const syncing = useRef(new Set<Id>());
  const { kv } = boot;

  const setSnaps = useCallback((f: (s: Record<Id, GitHubSnapshot>) => Record<Id, GitHubSnapshot>) => {
    const next = f(snapsRef.current);
    snapsRef.current = next;
    setSnapshots(next);
  }, []);

  const goStale = useCallback((reason: string) => {
    modeRef.current = 'stale'; setMode('stale'); setStaleReason(reason);
  }, []);

  /** Drops caches that no longer belong to their project (deleted / repo changed / restored data). Cache only; never local data. */
  const reconcileSnapshots = useCallback((projects: LocalData['projects']) => {
    const stale = D.staleSnapshotIds(projects, snapsRef.current);
    if (stale.length === 0) return;
    for (const id of stale) { try { kv.removeItem(snapshotKey(id)); } catch { /* cache only */ } }
    setSnaps((s) => Object.fromEntries(Object.entries(s).filter(([id]) => !stale.includes(id))));
    setSync((s) => Object.fromEntries(Object.entries(s).filter(([id]) => !stale.includes(id))));
  }, [kv, setSnaps]);

  const commit = useCallback((next: LocalData, allowedMode: Mode[]): Result => {
    if (!allowedMode.includes(modeRef.current)) return { ok: false, error: '読み取り専用のため変更できません' };
    const r = saveLocal(kv, next);
    if (!r.ok) {
      const p = describeSaveFailure(r);
      if (r.kind === 'conflict') { goStale('保存しようとしたところ、他のタブまたはウィンドウで新しいデータが保存されていました。'); }
      setSaveProblem(p);
      return { ok: false, error: `${p.message}${p.recovery ?? ''}` };
    }
    const saved = { ...next, revision: r.revision };
    dataRef.current = saved; setData(saved); setSaveProblem(null);
    reconcileSnapshots(saved.projects);
    return { ok: true };
  }, [kv, goStale, reconcileSnapshots]);

  const run = useCallback((op: (d: LocalData) => LocalData): Result => {
    let next: LocalData;
    try { next = op(dataRef.current); } catch (e) {
      return { ok: false, error: e instanceof D.DomainError ? e.message : '入力内容を処理できませんでした' };
    }
    return commit(next, ['normal']);
  }, [commit]);

  // Another tab changed the stored data: block editing here instead of letting this tab overwrite it later.
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.storageArea !== null && e.storageArea !== window.localStorage) return;
      if (e.key === null || e.key === LOCAL_KEY) {
        let rev: number | undefined;
        try { const p = e.newValue ? JSON.parse(e.newValue) : undefined; rev = isLocalData(p) ? p.revision : undefined; } catch { rev = undefined; }
        if (modeRef.current === 'normal' && rev !== dataRef.current.revision) {
          goStale('他のタブまたはウィンドウでデータが更新されました。');
        }
        return;
      }
      if (e.key.startsWith('adc:snapshot:v1:')) {
        const id = e.key.slice('adc:snapshot:v1:'.length);
        const p = dataRef.current.projects.find((x) => x.id === id);
        if (!p) return;
        let parsed: unknown;
        try { parsed = e.newValue ? JSON.parse(e.newValue) : undefined; } catch { parsed = undefined; }
        if (isSnapshot(parsed) && matchesProject(dataRef.current, id, parsed)) setSnaps((s) => ({ ...s, [id]: parsed as GitHubSnapshot }));
        else if (!e.newValue) setSnaps((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== id)));
      }
    };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, [goStale, setSnaps]);

  const syncProject = useCallback(async (projectId: Id) => {
    const p = dataRef.current.projects.find((x) => x.id === projectId);
    if (!p?.repo || syncing.current.has(projectId)) return;
    const requested = D.repoKey(p.repo);
    const repo = `${p.repo.owner}/${p.repo.name}`;
    syncing.current.add(projectId);
    setSync((s) => ({ ...s, [projectId]: { status: 'syncing' } }));
    // Still wanted only if the project exists and still points at the same repository.
    const stillWanted = (snap: GitHubSnapshot) => {
      const cur = dataRef.current.projects.find((x) => x.id === projectId);
      return !!cur?.repo && D.repoKey(cur.repo) === requested && snap.repo.toLowerCase() === requested;
    };
    try {
      const r = await refreshSnapshot(kv, projectId, repo, fetch, undefined, stillWanted);
      const cur = dataRef.current.projects.find((x) => x.id === projectId);
      if (r.ok) {
        setSnaps((s) => ({ ...s, [projectId]: r.snapshot }));
        setSync((s) => ({ ...s, [projectId]: { status: 'idle' } }));
      } else if (r.error.code === 'superseded' || !cur?.repo || D.repoKey(cur.repo) !== requested) {
        // Result belongs to an old project/repo: drop it silently; never report it against the current one.
        setSync((s) => (cur ? { ...s, [projectId]: { status: 'idle' } } : Object.fromEntries(Object.entries(s).filter(([k]) => k !== projectId))));
      } else {
        setSync((s) => ({ ...s, [projectId]: { status: 'failed', error: r.error } }));
      }
    } finally { syncing.current.delete(projectId); }
  }, [kv, setSnaps]);

  const shown = useMemo(() => Object.fromEntries(Object.entries(snapshots).filter(([id, s]) => matchesProject(data, id, s))), [snapshots, data]);

  const api = useMemo<AppApi>(() => ({
    data, mode, staleReason, persistent: boot.persistent,
    loadInfo: {
      recoveredFromPrev: boot.loaded.status === 'ok' && !!boot.loaded.recoveredFromPrev,
      migratedFrom: boot.loaded.status === 'ok' ? boot.loaded.migratedFrom : undefined,
      migrationFailed: boot.loaded.status === 'migration_failed' ? { fromVersion: boot.loaded.fromVersion, error: boot.loaded.error } : undefined,
      foundVersion: boot.loaded.status === 'readonly_newer_schema' ? boot.loaded.foundVersion : undefined,
      problems: boot.loaded.status === 'corrupt' ? boot.loaded.problems : undefined,
    },
    saveProblem, dismissSaveProblem: () => setSaveProblem(null),
    snapshots: shown, sync, syncProject, run,
    newId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    exportJson: () => exportBackup(dataRef.current),
    rawStored: () => { try { return kv.getItem(LOCAL_KEY); } catch { return null; } },
    importJson: (t) => parseBackup(t),
    applyImport: (imported) => {
      // Restoring is allowed in normal and corrupt mode, never over newer-schema data or from a stale tab.
      // Re-base on this tab's revision so the conflict check still protects against newer saves elsewhere.
      const r = commit({ ...imported, revision: dataRef.current.revision }, ['normal', 'corrupt']);
      if (r.ok) { modeRef.current = 'normal'; setMode('normal'); }
      return r;
    },
    startFresh: () => {
      if (modeRef.current !== 'corrupt') return { ok: false, error: '破損状態でのみ使用できます' };
      const r = commit({ ...emptyLocalData(), revision: dataRef.current.revision }, ['corrupt']);
      if (r.ok) { modeRef.current = 'normal'; setMode('normal'); }
      return r;
    },
  }), [data, mode, staleReason, boot, saveProblem, shown, sync, syncProject, run, commit, kv]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
