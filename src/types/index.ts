export type ISODate = string;
export type Id = string;

export interface Project {
  id: Id;
  name: string;
  repo?: { owner: string; name: string };
  description?: string;
  status: 'active' | 'paused' | 'done';
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Agent {
  id: Id;
  name: string;
  kind: 'claude-code-web' | 'codex-cloud' | 'human' | 'other';
  role: 'developer' | 'reviewer';
}

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'awaiting_owner' | 'done' | 'blocked';

export interface Task {
  id: Id;
  projectId: Id;
  title: string;
  notes?: string;
  status: TaskStatus;
  assigneeAgentId?: Id;
  links: { issueNumber?: number; prNumber?: number };
  ownerApproved: boolean;
  approvedAt?: ISODate;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** Manually entered by the human only. Never derived from GitHub history. */
export interface WorkSession {
  id: Id;
  projectId: Id;
  taskId?: Id;
  agentId: Id;
  startedAt?: ISODate;
  endedAt?: ISODate;
  durationMinutes?: number;
  source: 'manual';
  note?: string;
}

/** Human-authored data. Source of truth. Never touched by GitHub fetches. */
export interface LocalData {
  schemaVersion: number;
  projects: Project[];
  agents: Agent[];
  tasks: Task[];
  workSessions: WorkSession[];
}

export interface GhIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  author: string;
  createdAt: ISODate;
  closedAt?: ISODate;
  url: string;
  labels: string[];
}

export interface GhPull {
  number: number;
  title: string;
  state: 'open' | 'closed';
  merged: boolean;
  mergedAt?: ISODate;
  author: string;
  head: string;
  base: string;
  createdAt: ISODate;
  url: string;
}

export interface GhCommit {
  sha: string;
  message: string;
  author: string;
  committedAt: ISODate;
  url: string;
}

export interface GitHubRepoInfo {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: ISODate;
}

/**
 * Cache of remote data. Written only after ALL four requests succeeded
 * (no partial snapshots). Errors are reported separately, never stored here.
 */
export interface GitHubSnapshot {
  repo: string;
  fetchedAt: ISODate;
  info: GitHubRepoInfo;
  issues: GhIssue[];
  pulls: GhPull[];
  commits: GhCommit[];
  rateLimit?: RateLimitInfo;
}

export type SnapshotErrorCode = 'invalid_repo' | 'not_allowed' | 'rate_limited' | 'not_found' | 'private_repo' | 'upstream_error' | 'bad_response' | 'network' | 'method_not_allowed';

export interface SnapshotError {
  code: SnapshotErrorCode;
  message: string;
  resetAt?: ISODate;
}
