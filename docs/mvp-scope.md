# MVP scope and implementation plan

## Adopted (MVP)
- Project CRUD, Agent list, Task CRUD with status and owner-approval flag.
- Manual WorkSession entry (human-entered time only).
- Manual "Refresh from GitHub" per project via Netlify Function: latest 30 Issues / PRs / Commits, issue-PR dedupe, merged flag.
- Dashboard: per project open tasks, awaiting-owner tasks, last snapshot time, recent PRs/commits.
- localStorage persistence with atomic write, JSON export/import backup.
- Error states that preserve existing data.

## Deferred
Automatic polling/monitoring, multi-user auth, any GitHub write, AI-hours estimation from history, webhooks, notifications, GitHub OAuth for private repos, server-side database, Issue/PR comments or diffs.

## Phase 1 steps (after owner approval)
1. Scaffold Vite+React+TS, Tailwind, Vitest, Playwright, Netlify config; CI for typecheck/lint/unit.
2. Implement `types/` from data-model.md; storage layer with atomic write, schemaVersion, tests.
3. **First close the open verification**: run the real API calls from an unrestricted environment; save sanitized fixtures.
4. Implement `github-snapshot` function + validation + rate-limit mapping; unit tests with fixtures.
5. Implement dedupe/merged logic as pure functions; tests.
6. UI: Projects, Tasks, Sessions, GitHub panel; error banners.
7. Playwright E2E with mocked function responses; manual test against deploy preview.
8. Security review: bundle grep for token strings, GET-only check, allow-list.
9. Owner acceptance, then merge.

## Unresolved
- REST API access/limits unmeasured (see github-integration.md).
- Whether a server-side token will be provided (private repos are out of scope).
- Repo allow-list policy and Netlify site/domain.
- Whether Task<->Issue linking should be automated (currently manual numbers).
