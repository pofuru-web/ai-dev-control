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

/** 'human' is a legacy (schema v1) kind: still valid for existing data, no longer offered for new agents. */
export const AGENT_KINDS = ['chatgpt', 'claude-code-web', 'claude-code-cli', 'codex-cloud', 'codex-cli', 'gemini', 'other', 'human'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];
export const AGENT_ROLES = ['dev_manager', 'dev_lead', 'spec_design', 'developer', 'reviewer', 'qa'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export interface Agent {
  id: Id;
  name: string;
  kind: AgentKind;
  /** One or more roles (schema v2; v1 had a single `role`). Non-empty, no duplicates. */
  roles: AgentRole[];
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
  /** Work day as local calendar date YYYY-MM-DD (schema v2). Absent for old records: never back-filled. */
  workDate?: string;
  source: 'manual';
  note?: string;
}

/** Human-authored data. Source of truth. Never touched by GitHub fetches. */
export interface LocalData {
  schemaVersion: number;
  /**
   * Save counter used for multi-tab conflict detection. It is the revision this tab last loaded/saved;
   * a save is refused when the stored revision differs.
   */
  revision: number;
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

export type SnapshotErrorCode = 'invalid_repo' | 'not_allowed' | 'rate_limited' | 'not_found' | 'private_repo' | 'upstream_error' | 'bad_response' | 'network' | 'timeout' | 'method_not_allowed' | 'superseded';

export interface SnapshotError {
  code: SnapshotErrorCode;
  message: string;
  resetAt?: ISODate;
}
