import { describe, expect, it } from 'vitest';
import { exportBackup, parseBackup } from '../../src/lib/backup';
import { LOCAL_KEY, loadLocal, saveLocal } from '../../src/lib/storage';
import { MemKV, sampleData } from './helpers';

describe('backup', () => {
  it('export -> parse round-trips', () => {
    const r = parseBackup(exportBackup(sampleData()));
    expect(r.ok && r.data).toEqual(sampleData());
  });
  it('export contains no snapshot data', () => {
    expect(exportBackup(sampleData())).not.toContain('issues');
  });
  it('restore into storage works', () => {
    const kv = new MemKV();
    const r = parseBackup(exportBackup(sampleData('restored')));
    if (!r.ok) throw new Error('parse failed');
    expect(saveLocal(kv, r.data).ok).toBe(true);
    expect(loadLocal(kv).data.projects[0]?.name).toBe('restored');
  });
  it.each([
    ['not json', '{x'],
    ['wrong app', JSON.stringify({ app: 'other', data: sampleData() })],
    ['invalid data', JSON.stringify({ app: 'ai-dev-control', data: { schemaVersion: 1, projects: 'x' } })],
    ['newer schema', JSON.stringify({ app: 'ai-dev-control', data: { ...sampleData(), schemaVersion: 9 } })],
  ])('rejects %s without touching existing data', (_n, text) => {
    const kv = new MemKV();
    saveLocal(kv, sampleData('keep'));
    const before = kv.getItem(LOCAL_KEY);
    expect(parseBackup(text).ok).toBe(false);
    expect(kv.getItem(LOCAL_KEY)).toBe(before);
  });
});
