import { describe, expect, it } from 'vitest';
import { migrateLocalData } from '../../src/lib/migrations';
import { LOCAL_KEY, LOCAL_PREV_KEY, loadLocal, premigrationKey, saveLocal } from '../../src/lib/storage';
import { exportBackup, parseBackup } from '../../src/lib/backup';
import { isLocalData } from '../../src/lib/validate';
import { MemKV, T, sampleData, withRev } from './helpers';

// A schema v1 document exactly as Phase 1A/1B wrote it.
const v1 = () => ({
  schemaVersion: 1,
  projects: [{ id: 'p1', name: 'P', status: 'active', createdAt: T, updatedAt: T }],
  agents: [
    { id: 'a1', name: 'Claude', kind: 'claude-code-web', role: 'developer' },
    { id: 'a2', name: 'Codex', kind: 'codex-cloud', role: 'reviewer' },
    { id: 'a3', name: 'Me', kind: 'human', role: 'developer' },
  ],
  tasks: [{ id: 't1', projectId: 'p1', title: 'x', status: 'todo', links: {}, ownerApproved: false, createdAt: T, updatedAt: T }],
  workSessions: [
    { id: 'w1', projectId: 'p1', agentId: 'a1', durationMinutes: 30, source: 'manual' },
    { id: 'w2', projectId: 'p1', agentId: 'a1', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T01:00:00Z', durationMinutes: 60, source: 'manual' },
  ],
});

describe('v1 -> v2 migration', () => {
  it('converts role to roles and adds revision, nothing else changes', () => {
    const input = v1();
    const before = JSON.stringify(input);
    const r = migrateLocalData(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fromVersion).toBe(1);
    expect(r.data.schemaVersion).toBe(2);
    expect(r.data.revision).toBe(0);
    expect(r.data.agents.map((a) => a.roles)).toEqual([['developer'], ['reviewer'], ['developer']]);
    expect(r.data.agents.every((a) => !('role' in a))).toBe(true);
    expect(r.data.agents[2]?.kind).toBe('human'); // legacy kind kept, not rewritten
    expect(r.data.agents.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
    expect(r.data.projects).toEqual(input.projects);
    expect(r.data.tasks).toEqual(input.tasks);
    expect(isLocalData(r.data)).toBe(true);
    expect(JSON.stringify(input)).toBe(before); // input not mutated
  });
  it('does not invent dates for old work sessions', () => {
    const r = migrateLocalData(v1());
    if (!r.ok) throw new Error('migration failed');
    expect(r.data.workSessions[0]).not.toHaveProperty('workDate');
    expect(r.data.workSessions[1]).not.toHaveProperty('workDate');
    expect(r.data.workSessions[0]?.durationMinutes).toBe(30);
  });
  it('fails (without throwing) on data that cannot be migrated', () => {
    const bad = v1(); (bad.agents[0] as Record<string, unknown>).role = 'wizard';
    expect(migrateLocalData(bad).ok).toBe(false);
    const noRole = v1(); delete (noRole.agents[0] as Record<string, unknown>).role;
    expect(migrateLocalData(noRole).ok).toBe(false);
    expect(migrateLocalData({ schemaVersion: 1, agents: 5 }).ok).toBe(false);
    expect(migrateLocalData(null).ok).toBe(false);
    expect(migrateLocalData({ schemaVersion: 0 }).ok).toBe(false);
  });
  it('refuses unknown newer versions', () => { expect(migrateLocalData({ ...v1(), schemaVersion: 3 }).ok).toBe(false); });
  it('v2 data passes through unchanged', () => {
    const r = migrateLocalData(sampleData());
    expect(r.ok && r.data).toEqual(sampleData());
  });
});

describe('loading and saving across the migration', () => {
  it('loads v1 data migrated in memory without writing anything', () => {
    const kv = new MemKV();
    const raw = JSON.stringify(v1());
    kv.m.set(LOCAL_KEY, raw);
    const r = loadLocal(kv);
    expect(r.status).toBe('ok');
    expect(r.status === 'ok' && r.migratedFrom).toBe(1);
    expect(r.data.agents[0]?.roles).toEqual(['developer']);
    expect(kv.sets).toBe(0);
    expect(kv.getItem(LOCAL_KEY)).toBe(raw);
  });
  it('first save keeps a raw copy of the old data, then writes v2', () => {
    const kv = new MemKV();
    const raw = JSON.stringify(v1());
    kv.m.set(LOCAL_KEY, raw);
    const loaded = loadLocal(kv);
    const res = saveLocal(kv, { ...loaded.data, projects: loaded.data.projects.map((p) => ({ ...p, name: 'edited' })) });
    expect(res).toMatchObject({ ok: true, revision: 1 });
    expect(kv.getItem(premigrationKey(1))).toBe(raw);
    expect(JSON.parse(kv.getItem(LOCAL_KEY)!).schemaVersion).toBe(2);
    expect(loadLocal(kv).data.projects[0]?.name).toBe('edited');
    // a later save does not touch the pre-migration copy
    saveLocal(kv, withRev(kv, loadLocal(kv).data));
    expect(kv.getItem(premigrationKey(1))).toBe(raw);
  });
  it('if the raw copy cannot be written the old data is not replaced', () => {
    const kv = new MemKV();
    const raw = JSON.stringify(v1());
    kv.m.set(LOCAL_KEY, raw);
    const loaded = loadLocal(kv);
    kv.failSet = (k) => k.startsWith('adc:premigration');
    expect(saveLocal(kv, loaded.data)).toMatchObject({ ok: false, kind: 'migration_backup_failed' });
    expect(kv.getItem(LOCAL_KEY)).toBe(raw);
  });
  it('a different pre-migration value never overwrites an existing copy', () => {
    const kv = new MemKV();
    kv.m.set(premigrationKey(1), 'older copy');
    const raw = JSON.stringify(v1());
    kv.m.set(LOCAL_KEY, raw);
    saveLocal(kv, loadLocal(kv).data);
    expect(kv.getItem(premigrationKey(1))).toBe('older copy');
    expect(kv.getItem(premigrationKey(1, 1))).toBe(raw);
  });
  it('migration failure: status migration_failed, stored data untouched', () => {
    const kv = new MemKV();
    const bad = v1(); (bad.agents[0] as Record<string, unknown>).role = 'wizard';
    const raw = JSON.stringify(bad);
    kv.m.set(LOCAL_KEY, raw);
    const r = loadLocal(kv);
    expect(r.status).toBe('migration_failed');
    expect(kv.sets).toBe(0);
    expect(kv.getItem(LOCAL_KEY)).toBe(raw);
  });
  it('replacing unmigratable data (explicit restore) still keeps a raw copy first', () => {
    const kv = new MemKV();
    const bad = v1(); (bad.agents[0] as Record<string, unknown>).role = 'wizard';
    const raw = JSON.stringify(bad);
    kv.m.set(LOCAL_KEY, raw);
    expect(saveLocal(kv, sampleData('restored')).ok).toBe(true);
    expect(kv.getItem(premigrationKey(1))).toBe(raw);
  });
  it('a v1 prev copy from the old app is still usable for recovery', () => {
    const kv = new MemKV();
    kv.m.set(LOCAL_KEY, '{broken');
    kv.m.set(LOCAL_PREV_KEY, JSON.stringify(v1()));
    const r = loadLocal(kv);
    expect(r.status === 'ok' && r.recoveredFromPrev).toBe(true);
    expect(r.data.agents[0]?.roles).toEqual(['developer']);
  });
  it('unknown newer schema is still never overwritten', () => {
    const kv = new MemKV();
    const future = JSON.stringify({ ...sampleData(), schemaVersion: 3 });
    kv.m.set(LOCAL_KEY, future);
    expect(saveLocal(kv, sampleData())).toMatchObject({ ok: false, kind: 'newer_schema' });
    expect(kv.getItem(LOCAL_KEY)).toBe(future);
    expect(loadLocal(kv).status).toBe('readonly_newer_schema');
  });
});

describe('backups across versions', () => {
  it('restores an old (v1) backup file via migration', () => {
    const file = JSON.stringify({ app: 'ai-dev-control', exportedAt: T, data: v1() });
    const r = parseBackup(file);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.data.agents[1]?.roles).toEqual(['reviewer']); expect(r.data.workSessions[0]).not.toHaveProperty('workDate'); }
  });
  it('v2 backups round-trip and carry no revision', () => {
    const d = { ...sampleData(), revision: 7 };
    const text = exportBackup(d);
    expect(JSON.parse(text).data).not.toHaveProperty('revision');
    const r = parseBackup(text);
    expect(r.ok && { ...r.data, revision: 7 }).toEqual(d);
  });
  it('rejects a v1 backup that cannot be migrated and newer-schema backups', () => {
    const bad = v1(); (bad.agents[0] as Record<string, unknown>).role = 'wizard';
    expect(parseBackup(JSON.stringify({ app: 'ai-dev-control', data: bad })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ app: 'ai-dev-control', data: { ...v1(), schemaVersion: 9 } })).ok).toBe(false);
  });
});
