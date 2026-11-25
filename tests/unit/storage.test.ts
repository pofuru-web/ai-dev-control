import { describe, expect, it } from 'vitest';
import { LOCAL_KEY, LOCAL_PREV_KEY, loadLocal, loadSnapshot, saveLocal, saveSnapshot, snapshotKey } from '../../src/lib/storage';
import { MemKV, sampleData } from './helpers';

describe('local storage', () => {
  it('empty store loads as empty', () => {
    expect(loadLocal(new MemKV()).status).toBe('empty');
  });

  it('save then load round-trips', () => {
    const kv = new MemKV();
    expect(saveLocal(kv, sampleData()).ok).toBe(true);
    const r = loadLocal(kv);
    expect(r.status).toBe('ok');
    expect(r.data.projects[0]?.name).toBe('P');
  });

  it('keeps previous generation under a second key', () => {
    const kv = new MemKV();
    saveLocal(kv, sampleData('one'));
    saveLocal(kv, sampleData('two'));
    expect(JSON.parse(kv.getItem(LOCAL_PREV_KEY)!).projects[0].name).toBe('one');
    expect(JSON.parse(kv.getItem(LOCAL_KEY)!).projects[0].name).toBe('two');
  });

  it('failed write (quota) keeps old data and reports failure', () => {
    const kv = new MemKV();
    saveLocal(kv, sampleData('old'));
    kv.failSet = (k) => k === LOCAL_KEY;
    const r = saveLocal(kv, sampleData('new'));
    expect(r.ok).toBe(false);
    expect(loadLocal(kv).data.projects[0]?.name).toBe('old');
  });

  it('failure of the prev-copy write does not break the main write', () => {
    const kv = new MemKV();
    saveLocal(kv, sampleData('old'));
    kv.failSet = (k) => k === LOCAL_PREV_KEY;
    expect(saveLocal(kv, sampleData('new')).ok).toBe(true);
    expect(loadLocal(kv).data.projects[0]?.name).toBe('new');
  });

  it('recovers from prev when main is corrupt', () => {
    const kv = new MemKV();
    saveLocal(kv, sampleData('one'));
    saveLocal(kv, sampleData('two'));
    kv.m.set(LOCAL_KEY, '{broken');
    const r = loadLocal(kv);
    expect(r.status).toBe('ok');
    expect(r.status === 'ok' && r.recoveredFromPrev).toBe(true);
    expect(r.data.projects[0]?.name).toBe('one');
  });

  it('corrupt main without prev reports corrupt and does not delete the raw value', () => {
    const kv = new MemKV();
    kv.m.set(LOCAL_KEY, '{broken');
    expect(loadLocal(kv).status).toBe('corrupt');
    expect(kv.getItem(LOCAL_KEY)).toBe('{broken');
  });

  it('newer schema version is read-only and untouched', () => {
    const kv = new MemKV();
    kv.m.set(LOCAL_KEY, JSON.stringify({ ...sampleData(), schemaVersion: 99 }));
    const r = loadLocal(kv);
    expect(r.status).toBe('readonly_newer_schema');
    expect(kv.getItem(LOCAL_KEY)).toContain('"schemaVersion":99');
  });

  it('rejects invalid data before touching storage', () => {
    const kv = new MemKV();
    saveLocal(kv, sampleData('old'));
    const bad = sampleData('bad');
    bad.workSessions[0]!.durationMinutes = 5; // inconsistent with start/end
    const sets = kv.sets;
    expect(saveLocal(kv, bad).ok).toBe(false);
    expect(kv.sets).toBe(sets);
    expect(loadLocal(kv).data.projects[0]?.name).toBe('old');
  });
});

describe('snapshot storage', () => {
  const snap = { repo: 'a/b', fetchedAt: '2026-01-01T00:00:00Z', info: { fullName: 'a/b', defaultBranch: 'main', private: false, htmlUrl: '' }, issues: [], pulls: [], commits: [] };
  it('is stored under a separate key and not mixed with local data', () => {
    const kv = new MemKV();
    saveLocal(kv, sampleData());
    saveSnapshot(kv, 'p1', snap);
    expect(snapshotKey('p1')).not.toBe(LOCAL_KEY);
    expect(loadLocal(kv).data).toEqual(sampleData());
    expect(loadSnapshot(kv, 'p1')?.repo).toBe('a/b');
  });
  it('failed snapshot write keeps the previous snapshot', () => {
    const kv = new MemKV();
    saveSnapshot(kv, 'p1', snap);
    kv.failSet = () => true;
    expect(saveSnapshot(kv, 'p1', { ...snap, fetchedAt: '2027-01-01T00:00:00Z' }).ok).toBe(false);
    expect(loadSnapshot(kv, 'p1')?.fetchedAt).toBe('2026-01-01T00:00:00Z');
  });
});

describe('read-back failure and recovery', () => {
  // KV whose main-key write is silently corrupted for values containing a marker.
  class CorruptingKV extends MemKV {
    corruptMarker = '"name":"new"';
    failRestore = false;
    setItem(k: string, v: string) {
      if (k === LOCAL_KEY && v.includes(this.corruptMarker)) { this.sets++; this.m.set(k, v.slice(0, 20)); return; }
      if (k === LOCAL_KEY && this.failRestore && this.m.get(k)?.length === 20) { this.sets++; throw new Error('QuotaExceededError'); }
      super.setItem(k, v);
    }
  }

  it('silent corruption: previous value is restored and verified, failure is reported', () => {
    const kv = new CorruptingKV();
    saveLocal(kv, sampleData('old'));
    const r = saveLocal(kv, sampleData('new'));
    expect(r).toMatchObject({ ok: false, error: 'read-back mismatch', recovery: 'restored_previous' });
    const loaded = loadLocal(kv);
    expect(loaded.status).toBe('ok');
    expect(loaded.data.projects[0]?.name).toBe('old');
  });

  it('first-ever save that reads back wrong is removed (nothing half-written remains)', () => {
    const kv = new CorruptingKV();
    const r = saveLocal(kv, sampleData('new'));
    expect(r).toMatchObject({ ok: false, recovery: 'removed_new' });
    expect(kv.getItem(LOCAL_KEY)).toBeNull();
    expect(loadLocal(kv).status).toBe('empty');
  });

  it('restore itself fails: reported as restore_failed and load still recovers old data from prev', () => {
    const kv = new CorruptingKV();
    saveLocal(kv, sampleData('old'));
    kv.failRestore = true;
    const r = saveLocal(kv, sampleData('new'));
    expect(r).toMatchObject({ ok: false, recovery: 'restore_failed' });
    expect(kv.getItem(LOCAL_KEY)).not.toBeNull(); // corrupt main is not deleted
    const loaded = loadLocal(kv);
    expect(loaded.status).toBe('ok');
    expect(loaded.status === 'ok' && loaded.recoveredFromPrev).toBe(true);
    expect(loaded.data.projects[0]?.name).toBe('old');
  });

  it('getItem throwing during read-back: reported, restore attempted', () => {
    const kv = new MemKV();
    saveLocal(kv, sampleData('old'));
    const origGet = kv.getItem.bind(kv);
    let armed = false;
    const origSet = kv.setItem.bind(kv);
    kv.setItem = (k, v) => { origSet(k, v); if (k === LOCAL_KEY && v.includes('"name":"new"')) armed = true; };
    kv.getItem = (k) => { if (armed && k === LOCAL_KEY) { armed = false; throw new Error('SecurityError'); } return origGet(k); };
    const r = saveLocal(kv, sampleData('new'));
    expect(r).toMatchObject({ ok: false, recovery: 'restored_previous' });
    expect(loadLocal(kv).data.projects[0]?.name).toBe('old');
  });

  it('successful save never reports a recovery', () => {
    expect(saveLocal(new MemKV(), sampleData())).toEqual({ ok: true });
  });
});

describe('pre-write protection', () => {
  it('aborts without writing when the existing data cannot be read', () => {
    const kv = new MemKV();
    saveLocal(kv, sampleData('old'));
    const snapshotOfMap = new Map(kv.m);
    const origGet = kv.getItem.bind(kv);
    kv.getItem = (k) => { if (k === LOCAL_KEY) throw new Error('SecurityError'); return origGet(k); };
    const sets = kv.sets;
    const r = saveLocal(kv, sampleData('new'));
    expect(r).toMatchObject({ ok: false, kind: 'read_failed' });
    expect(kv.sets).toBe(sets); // no setItem at all
    expect(kv.m).toEqual(snapshotOfMap);
  });

  it('aborts when the prev key cannot be read either', () => {
    const kv = new MemKV();
    saveLocal(kv, sampleData('old'));
    const origGet = kv.getItem.bind(kv);
    kv.getItem = (k) => { if (k === LOCAL_PREV_KEY) throw new Error('x'); return origGet(k); };
    const sets = kv.sets;
    expect(saveLocal(kv, sampleData('new'))).toMatchObject({ ok: false, kind: 'read_failed' });
    expect(kv.sets).toBe(sets);
  });

  it('never overwrites a newer schemaVersion in the main key', () => {
    const kv = new MemKV();
    const future = JSON.stringify({ ...sampleData('future'), schemaVersion: 99 });
    kv.m.set(LOCAL_KEY, future);
    const sets = kv.sets;
    expect(saveLocal(kv, sampleData('new'))).toMatchObject({ ok: false, kind: 'newer_schema' });
    expect(kv.sets).toBe(sets);
    expect(kv.getItem(LOCAL_KEY)).toBe(future);
  });

  it('never overwrites when only the prev key holds a newer schema', () => {
    const kv = new MemKV();
    const future = JSON.stringify({ ...sampleData('future'), schemaVersion: 7 });
    kv.m.set(LOCAL_PREV_KEY, future);
    expect(saveLocal(kv, sampleData('new'))).toMatchObject({ ok: false, kind: 'newer_schema' });
    expect(kv.getItem(LOCAL_PREV_KEY)).toBe(future);
    expect(kv.getItem(LOCAL_KEY)).toBeNull();
  });

  it('a newer-schema prev is not used for recovery', () => {
    const kv = new MemKV();
    kv.m.set(LOCAL_PREV_KEY, JSON.stringify({ ...sampleData('future'), schemaVersion: 7 }));
    expect(loadLocal(kv).status).toBe('empty');
  });

  it('a corrupt (not newer) main may still be replaced by an explicit save', () => {
    const kv = new MemKV();
    kv.m.set(LOCAL_KEY, '{broken');
    expect(saveLocal(kv, sampleData('fresh')).ok).toBe(true);
  });
});

describe('approval invariant', () => {
  it('done without approval is rejected, approval without done is rejected', () => {
    const d = sampleData();
    d.tasks[0]!.status = 'done';
    expect(saveLocal(new MemKV(), d).ok).toBe(false);
    const e = sampleData();
    e.tasks[0]!.ownerApproved = true; e.tasks[0]!.approvedAt = '2026-01-01T00:00:00Z';
    expect(saveLocal(new MemKV(), e).ok).toBe(false);
    const f = sampleData();
    Object.assign(f.tasks[0]!, { status: 'done', ownerApproved: true, approvedAt: '2026-01-01T00:00:00Z' });
    expect(saveLocal(new MemKV(), f).ok).toBe(true);
  });
});
