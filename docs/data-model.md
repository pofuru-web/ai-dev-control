# Data model

> The TypeScript block under "Types" is the **Phase 0 sketch and is superseded**: `Agent.role`, the `GitHubSnapshot` fields and others changed. The authoritative definitions are `src/types/index.ts`, and the current schema (v2) is described in "Phase 1C changes" at the end of this file.

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

## Phase 1C changes (schema v2)
Authoritative types: `src/types/index.ts`. `SCHEMA_VERSION = 2`.

| Change | v1 | v2 |
|---|---|---|
| Agent roles | `role` (one of developer / reviewer) | `roles` (1+ of dev_manager, dev_lead, spec_design, developer, reviewer, qa) |
| Agent kind | claude-code-web, codex-cloud, human, other | chatgpt, claude-code-web, claude-code-cli, codex-cloud, codex-cli, gemini, other; `human` stays valid as a legacy value (not offered for new agents) |
| WorkSession date | none | optional `workDate` (YYYY-MM-DD, local calendar date). Range sessions use the local date of `startedAt`. Old records stay undated: **no date is ever invented** |
| LocalData | - | `revision` (non-negative integer save counter) |

### Migration (`src/lib/migrations.ts`)
- Pure function chain v1 -> v2; never mutates its input; result must pass validation or the migration fails.
- Loading older data migrates **in memory only**; nothing is written on load.
- First save that would replace older-schema data first writes the raw old value to `adc:premigration:v<N>` (never overwritten; a differing value goes to `:1`, `:2`...). If that write fails the save is refused and the old data stays.
- Migration failure: status `migration_failed`, data untouched, editing blocked, raw data downloadable from the data page. An explicit restore/"start fresh" is still possible but also keeps the raw copy first.
- Old (v1) backup files are migrated on import. Backups no longer contain `revision`.
- Newer unknown schema: read-only, never overwritten (main or prev key).

### Multi-tab protection
- Every save writes `revision + 1` and is refused (`kind: 'conflict'`, nothing written) if the stored revision differs from the revision the tab holds.
- A `storage` event from another tab puts this tab in `stale` mode at once: editing and restore are disabled, banner offers reload; backup download stays possible.
- **Limit:** the check and the write are separate synchronous steps and browsers do not guarantee mutual exclusion of localStorage across tabs, so two tabs saving in the same instant cannot be excluded. Web Locks was considered but not used: it is asynchronous and would make every save asynchronous; it would also not protect against environments without it. The UI states this limit.

### GitHub cache integrity
- A snapshot is shown only if its `repo` equals the project's current repo (case-insensitive) and the project exists.
- Changing a project's repo, deleting a project, or restoring a backup removes caches that no longer match (cache only; local data is never touched).
- A sync result is saved only if, at the moment the response arrives, the project still exists with the same repo; otherwise it is discarded (`superseded`) and not reported against the current repo.

### Approval
Editing the title, notes, project or Issue/PR links of an approved task revokes approval and returns it to `awaiting_owner`; the form warns first and asks for confirmation. Assignee-only edits keep the approval. GitHub merged state and owner approval are displayed and stored separately.

### Adopted v0.1 policies (decided by the owner after Phase 1C)
1. An assignee-only change does not revoke an approval.
2. The legacy agent kind `human` is kept for compatibility.
3. The revision starts at 0 when v1 data is migrated to v2.
4. Work records without a date are included only in all-time totals; dates are never guessed.

Owner acceptance of Phase 1C on the deployed site (commit f596c5a, 7/7 items) is recorded in docs/test-plan.md. It did not verify exclusion of two saves at exactly the same instant; that remains a documented limit.
