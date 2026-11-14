import { describe, expect, it } from 'vitest';
import { workSessionProblems } from '../../src/lib/validate';

const base = { id: 'w', projectId: 'p', agentId: 'a', source: 'manual' as const };
describe('WorkSession consistency', () => {
  it('accepts matching start/end/duration', () => {
    expect(workSessionProblems({ ...base, startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:30:00Z', durationMinutes: 30 })).toEqual([]);
  });
  it('accepts duration only', () => { expect(workSessionProblems({ ...base, durationMinutes: 15 })).toEqual([]); });
  it('rejects end before start', () => {
    expect(workSessionProblems({ ...base, startedAt: '2026-01-01T01:00:00Z', endedAt: '2026-01-01T00:00:00Z' })).toContain('endedAt is before startedAt');
  });
  it('rejects mismatched duration', () => {
    expect(workSessionProblems({ ...base, startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:30:00Z', durationMinutes: 90 }).length).toBe(1);
  });
  it('rejects negative duration and bad dates', () => {
    expect(workSessionProblems({ ...base, durationMinutes: -1 }).length).toBeGreaterThan(0);
    expect(workSessionProblems({ ...base, startedAt: 'nope', durationMinutes: 1 }).length).toBeGreaterThan(0);
  });
  it('rejects non-manual source (no history inference)', () => {
    expect(workSessionProblems({ ...base, source: 'github-inferred', durationMinutes: 5 })).toContain('source must be "manual"');
  });
  it('rejects empty time info and half-open ranges', () => {
    expect(workSessionProblems(base).length).toBe(1);
    expect(workSessionProblems({ ...base, startedAt: '2026-01-01T00:00:00Z' }).length).toBe(1);
  });
});
