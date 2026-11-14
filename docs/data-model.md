# Data model (Phase 0 draft)

All types are design proposals; not implemented or compiled yet.

## Storage separation
| localStorage key | Content | Owner | On API error |
|---|---|---|---|
| `adc:local:v1` | Project, Agent, Task, WorkSession | human | untouched |
| `adc:snapshot:v1:{projectId}` | GitHubSnapshot (cache) | fetch | previous value kept |
| `adc:meta:v1` | schemaVersion, lastBackupAt | app | untouched |

Writes (Phase 1A): local data is ONE key (`adc:local:v1`), so each `setItem` replaces it as a unit. Cross-key updates are **not atomic**: before overwriting, the last valid generation is copied to `adc:local:v1:prev` as a best-effort recovery copy (two sequential writes). Flow: validate -> serialize -> round-trip check -> copy prev -> set main -> read-back. If any step fails the previous main value is left in place and the failure is returned. On load, a corrupt main falls back to `prev`; a newer `schemaVersion` is read-only and never overwritten. The snapshot key is written independently of local data.

Read-back failure handling (`SaveResult.recovery`): if the post-write read-back mismatches or throws, the previous main value is written back and verified (`restored_previous`); on a first-ever save the unverifiable value is removed (`removed_new`); if restoring also fails (`restore_failed`) the corrupt main is NOT deleted, `loadLocal` falls back to `adc:local:v1:prev`, and the UI must tell the user to export a backup. Every non-ok result is shown to the user; it is never swallowed.

## Types (TypeScript)
```ts
type ISODate = string; // ISO 8601
type Id = string;      // uuid

interface Project {
  id: Id; name: string;
  repo?: { owner: string; name: string }; // GitHub link, read-only usage
  description?: string;
  status: 'active' | 'paused' | 'done';
  approver: 'owner';                       // final approver is always the human
  createdAt: ISODate; updatedAt: ISODate;
}

interface Agent {
  id: Id; name: string;
  kind: 'claude-code-web' | 'codex-cloud' | 'human' | 'other';
  role: 'developer' | 'reviewer';
}

type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'awaiting_owner' | 'done' | 'blocked';
interface Task {
  id: Id; projectId: Id; title: string; notes?: string;
  status: TaskStatus;
  assigneeAgentId?: Id;
  links: { issueNumber?: number; prNumber?: number }; // references only, user-entered
  ownerApproved: boolean; approvedAt?: ISODate;       // only human sets this
  createdAt: ISODate; updatedAt: ISODate;
}

// Hours are ONLY self-reported by the human. Never derived from commit/PR timestamps.
interface WorkSession {
  id: Id; projectId: Id; taskId?: Id; agentId: Id;
  startedAt?: ISODate; endedAt?: ISODate;
  durationMinutes?: number;
  source: 'manual';   // literal type: forbids 'github-inferred'
  note?: string;
}

// Cache of remote data. Replaceable; never edited by the user.
interface GitHubSnapshot {
  projectId: Id; repo: string;
  fetchedAt: ISODate;
  info: GitHubRepoInfo;
  rateLimit?: { limit: number; remaining: number; resetAt: ISODate };
  etags?: { issues?: string; pulls?: string; commits?: string };
  issues: GhIssue[];      // pull requests removed (see dedupe)
  pulls: GhPull[];
  commits: GhCommit[];
}
interface GhIssue  { number: number; title: string; state: 'open'|'closed'; author: string; createdAt: ISODate; closedAt?: ISODate; url: string; labels: string[] }
interface GhPull   { number: number; title: string; state: 'open'|'closed'; merged: boolean; mergedAt?: ISODate; author: string; head: string; base: string; createdAt: ISODate; url: string }
interface GhCommit { sha: string; message: string; author: string; committedAt: ISODate; url: string }
```

## Relationships
Project 1-N Task, Project 1-N WorkSession, Task 1-N WorkSession, Agent 1-N Task/WorkSession. Task -> GitHub is a loose number reference resolved at render time against the snapshot; a missing snapshot never invalidates a Task.

## Rules
- Snapshot never writes into Task/Project. Linking is by display join only.
- `ownerApproved` is only settable via explicit UI action by the human.
- Snapshots are written only after all four fetches succeed (no `partial` state, no error stored in the snapshot).
- WorkSession validation: `source === 'manual'`; durations >= 0; `endedAt >= startedAt`; if start, end and duration are all present they must agree within 1 minute; start/end must be given together unless only a duration is given; at least one time field is required.
- Authoritative types are in `src/types/index.ts` (the TS block above is the Phase 0 sketch).
- Export/import JSON of `adc:local:v1` provides backup (Phase 1, optional).
