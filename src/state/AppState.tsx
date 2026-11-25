import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GitHubSnapshot, Id, LocalData, SnapshotError } from '../types';
import { loadLocal, loadSnapshot, saveLocal, type KV, type SaveResult } from '../lib/storage';
import { emptyLocalData } from '../lib/validate';
import { refreshSnapshot } from '../lib/github/client';
import { parseBackup, exportBackup } from '../lib/backup';
import * as D from '../lib/domain';

export type Mode = 'normal' | 'newer_schema' | 'corrupt';
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
  const rec = r.recovery === 'restored_previous' ? '直前のデータを書き戻して検証済みです。'
    : r.recovery === 'removed_new' ? '検証できなかった新しいデータは削除しました。'
    : r.recovery === 'restore_failed' ? '直前のデータへの復旧にも失敗しました。画面のデータは失われていません。すぐに「データ管理」からバックアップをダウンロードしてください。'
    : '直前のデータは保持されています。';
  return { message: `保存に失敗しました（${r.error}）。`, recovery: rec };
}

function init() {
  const { kv, persistent } = pickKv();
  const loaded = loadLocal(kv);
  const mode: Mode = loaded.status === 'readonly_newer_schema' ? 'newer_schema' : loaded.status === 'corrupt' ? 'corrupt' : 'normal';
  const snaps: Record<Id, GitHubSnapshot> = {};
  for (const p of loaded.data.projects) { const s = loadSnapshot(kv, p.id); if (s) snaps[p.id] = s; }
  return { kv, persistent, loaded, mode, snaps };
}

export interface AppApi {
  data: LocalData;
  mode: Mode;
  persistent: boolean;
  loadInfo: { recoveredFromPrev: boolean; foundVersion?: number; problems?: string[] };
  saveProblem: SaveProblem | null;
  dismissSaveProblem(): void;
  snapshots: Record<Id, GitHubSnapshot>;
  sync: Record<Id, SyncState>;
  syncProject(projectId: Id): Promise<void>;
  run(op: (d: LocalData) => LocalData): Result;
  newId(): Id;
  now(): string;
  exportJson(): string;
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
  const [snapshots, setSnapshots] = useState(boot.snaps);
  const [sync, setSync] = useState<Record<Id, SyncState>>({});
  const [saveProblem, setSaveProblem] = useState<SaveProblem | null>(null);
  const dataRef = useRef(data);
  const modeRef = useRef(mode);
  const syncing = useRef(new Set<Id>());
  const { kv } = boot;

  const commit = useCallback((next: LocalData, allowedMode: Mode[]): Result => {
    if (!allowedMode.includes(modeRef.current)) return { ok: false, error: '読み取り専用のため変更できません' };
    const r = saveLocal(kv, next);
    if (!r.ok) {
      const p = describeSaveFailure(r);
      setSaveProblem(p);
      return { ok: false, error: `${p.message}${p.recovery ?? ''}` };
    }
    dataRef.current = next; setData(next); setSaveProblem(null);
    return { ok: true };
  }, [kv]);

  const run = useCallback((op: (d: LocalData) => LocalData): Result => {
    let next: LocalData;
    try { next = op(dataRef.current); } catch (e) {
      return { ok: false, error: e instanceof D.DomainError ? e.message : '入力内容を処理できませんでした' };
    }
    return commit(next, ['normal']);
  }, [commit]);

  const syncProject = useCallback(async (projectId: Id) => {
    const p = dataRef.current.projects.find((x) => x.id === projectId);
    if (!p?.repo || syncing.current.has(projectId)) return;
    syncing.current.add(projectId);
    setSync((s) => ({ ...s, [projectId]: { status: 'syncing' } }));
    try {
      const r = await refreshSnapshot(kv, projectId, `${p.repo.owner}/${p.repo.name}`);
      if (r.ok) {
        setSnapshots((s) => ({ ...s, [projectId]: r.snapshot }));
        setSync((s) => ({ ...s, [projectId]: { status: 'idle' } }));
      } else {
        // Existing snapshot stays in state and in storage.
        setSync((s) => ({ ...s, [projectId]: { status: 'failed', error: r.error } }));
      }
    } finally { syncing.current.delete(projectId); }
  }, [kv]);

  const api = useMemo<AppApi>(() => ({
    data, mode, persistent: boot.persistent,
    loadInfo: {
      recoveredFromPrev: boot.loaded.status === 'ok' && !!boot.loaded.recoveredFromPrev,
      foundVersion: boot.loaded.status === 'readonly_newer_schema' ? boot.loaded.foundVersion : undefined,
      problems: boot.loaded.status === 'corrupt' ? boot.loaded.problems : undefined,
    },
    saveProblem, dismissSaveProblem: () => setSaveProblem(null),
    snapshots, sync, syncProject, run,
    newId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    exportJson: () => exportBackup(dataRef.current),
    importJson: (t) => parseBackup(t),
    applyImport: (d) => {
      // Restoring is allowed in normal and corrupt mode, never over newer-schema data.
      const r = commit(d, ['normal', 'corrupt']);
      if (r.ok) { modeRef.current = 'normal'; setMode('normal'); }
      return r;
    },
    startFresh: () => {
      if (modeRef.current !== 'corrupt') return { ok: false, error: '破損状態でのみ使用できます' };
      const r = commit(emptyLocalData(), ['corrupt']);
      if (r.ok) { modeRef.current = 'normal'; setMode('normal'); }
      return r;
    },
  }), [data, mode, boot, saveProblem, snapshots, sync, syncProject, run, commit]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
