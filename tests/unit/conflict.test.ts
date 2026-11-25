import { describe, expect, it } from 'vitest';
import { LOCAL_KEY, loadLocal, saveLocal } from '../../src/lib/storage';
import { MemKV, sampleData } from './helpers';

describe('multi-tab revision protection', () => {
  it('each successful save advances the revision', () => {
    const kv = new MemKV();
    const a = saveLocal(kv, sampleData('1'));
    expect(a).toMatchObject({ ok: true, revision: 1 });
    const b = saveLocal(kv, { ...sampleData('2'), revision: 1 });
    expect(b).toMatchObject({ ok: true, revision: 2 });
    expect(loadLocal(kv).data.revision).toBe(2);
  });

  it('a tab holding an old revision cannot overwrite newer data', () => {
    const kv = new MemKV();
    saveLocal(kv, sampleData('base'));                                 // stored revision 1
    const tabA = loadLocal(kv).data;                                   // both tabs load revision 1
    const tabB = loadLocal(kv).data;
    expect(saveLocal(kv, { ...tabA, projects: [{ ...tabA.projects[0]!, name: 'from A' }] })).toMatchObject({ ok: true, revision: 2 });
    const storedByA = kv.getItem(LOCAL_KEY);
    const r = saveLocal(kv, { ...tabB, projects: [{ ...tabB.projects[0]!, name: 'from B (stale)' }] });
    expect(r).toMatchObject({ ok: false, kind: 'conflict' });
    expect(kv.getItem(LOCAL_KEY)).toBe(storedByA);                     // A's data untouched
    expect(loadLocal(kv).data.projects[0]?.name).toBe('from A');
  });

  it('a conflict writes nothing at all (no prev copy, no setItem)', () => {
    const kv = new MemKV();
    saveLocal(kv, sampleData('base'));
    const stale = loadLocal(kv).data;
    saveLocal(kv, stale);
    const sets = kv.sets; const snapshot = new Map(kv.m);
    expect(saveLocal(kv, stale)).toMatchObject({ ok: false, kind: 'conflict' });
    expect(kv.sets).toBe(sets);
    expect(kv.m).toEqual(snapshot);
  });

  it('after reloading (re-basing) the stale tab can save again', () => {
    const kv = new MemKV();
    saveLocal(kv, sampleData('base'));
    const stale = loadLocal(kv).data;
    saveLocal(kv, stale);
    expect(saveLocal(kv, stale).ok).toBe(false);
    expect(saveLocal(kv, loadLocal(kv).data).ok).toBe(true);
  });

  it('a corrupt stored value does not block an explicit save (nothing valid to conflict with)', () => {
    const kv = new MemKV();
    kv.m.set(LOCAL_KEY, '{broken');
    expect(saveLocal(kv, sampleData('fresh')).ok).toBe(true);
  });

  it('an empty store accepts a first save from revision 0', () => {
    expect(saveLocal(new MemKV(), sampleData()).ok).toBe(true);
  });
});
