import { describe, expect, it } from 'vitest';
import { refreshSnapshot } from '../../src/lib/github/client';
import { loadSnapshot, saveSnapshot, snapshotKey } from '../../src/lib/storage';
import { MemKV } from '../unit/helpers';
import type { GitHubSnapshot } from '../../src/types';

const snap = (repo: string, fetchedAt = '2026-01-01T00:00:00.000Z'): GitHubSnapshot => ({ repo, fetchedAt, info: { fullName: repo, defaultBranch: 'main', private: false, htmlUrl: 'https://github.com/' + repo }, issues: [], pulls: [], commits: [] });
const respond = (s: GitHubSnapshot) => (async () => new Response(JSON.stringify({ ok: true, snapshot: s }))) as unknown as typeof fetch;

describe('sync result vs. project changes during the request', () => {
  it('stored when still wanted', async () => {
    const kv = new MemKV();
    const r = await refreshSnapshot(kv, 'p1', 'o/a', respond(snap('o/a')), 1000, () => true);
    expect(r.ok).toBe(true);
    expect(loadSnapshot(kv, 'p1')?.repo).toBe('o/a');
  });
  it('discarded (nothing written) when the project/repo changed meanwhile', async () => {
    const kv = new MemKV();
    const r = await refreshSnapshot(kv, 'p1', 'o/a', respond(snap('o/a')), 1000, () => false);
    expect(r).toMatchObject({ ok: false, error: { code: 'superseded' } });
    expect(kv.getItem(snapshotKey('p1'))).toBeNull();
    expect(kv.sets).toBe(0);
  });
  it('the guard runs after the response arrives (state at that moment decides)', async () => {
    const kv = new MemKV();
    let repoNow = 'o/a';
    const slow = (async () => { repoNow = 'o/changed'; return new Response(JSON.stringify({ ok: true, snapshot: snap('o/a') })); }) as unknown as typeof fetch;
    const r = await refreshSnapshot(kv, 'p1', 'o/a', slow, 1000, () => repoNow === 'o/a');
    expect(r.ok).toBe(false);
    expect(kv.getItem(snapshotKey('p1'))).toBeNull();
  });
  it('an existing cache survives a superseded result', async () => {
    const kv = new MemKV();
    saveSnapshot(kv, 'p1', snap('o/a', '2025-01-01T00:00:00.000Z'));
    const before = kv.getItem(snapshotKey('p1'));
    await refreshSnapshot(kv, 'p1', 'o/a', respond(snap('o/a', '2026-06-01T00:00:00.000Z')), 1000, () => false);
    expect(kv.getItem(snapshotKey('p1'))).toBe(before);
  });
  it('a response for a different repository than requested is rejected', async () => {
    const kv = new MemKV();
    const r = await refreshSnapshot(kv, 'p1', 'o/a', respond(snap('o/other')), 1000, () => true);
    expect(r).toMatchObject({ ok: false, error: { code: 'bad_response' } });
    expect(kv.getItem(snapshotKey('p1'))).toBeNull();
  });
  it('repo match is case-insensitive', async () => {
    const kv = new MemKV();
    expect((await refreshSnapshot(kv, 'p1', 'O/A', respond(snap('o/a')), 1000)).ok).toBe(true);
  });
});
