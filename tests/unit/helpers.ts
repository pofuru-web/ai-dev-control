import type { KV } from '../../src/lib/storage';
import type { LocalData } from '../../src/types';

export class MemKV implements KV {
  m = new Map<string, string>();
  failSet: ((key: string, n: number) => boolean) | null = null;
  sets = 0;
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) {
    this.sets++;
    if (this.failSet?.(k, this.sets)) throw new Error('QuotaExceededError');
    this.m.set(k, v);
  }
  removeItem(k: string) { this.m.delete(k); }
}

export const T = '2026-01-01T00:00:00.000Z';
export const sampleData = (name = 'P'): LocalData => ({
  schemaVersion: 1,
  projects: [{ id: 'p1', name, status: 'active', createdAt: T, updatedAt: T }],
  agents: [{ id: 'a1', name: 'Claude', kind: 'claude-code-web', role: 'developer' }],
  tasks: [{ id: 't1', projectId: 'p1', title: 'x', status: 'todo', links: {}, ownerApproved: false, createdAt: T, updatedAt: T }],
  workSessions: [{ id: 'w1', projectId: 'p1', agentId: 'a1', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T01:00:00Z', durationMinutes: 60, source: 'manual' }],
});
