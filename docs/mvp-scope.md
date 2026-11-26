# MVP scope (v0.1) — status as of Phase 1D

This file started as the Phase 0 plan. It now records what v0.1 contains. Details of what is implemented and not: `docs/release-notes-v0.1.md`.

## In v0.1 (implemented)
- Projects (create/edit/delete, GitHub repo setting, status), agents (7 kinds, multiple roles, edit), tasks (6-state kanban, assignee, manual Issue/PR links, explicit owner approval), manual work time (date or start/end, edit, today/week/month/all totals).
- Manual GET-only GitHub sync through a Netlify Function: latest 30 Issues / PRs / Commits, issue-PR dedupe, merged flag, rate-limit display, old data kept on any failure.
- localStorage persistence with schema versioning (v2), v1 migration, JSON backup/restore, multi-tab conflict refusal.
- Japanese dark UI with left navigation; responsive.

## Not in v0.1
Automatic sync/monitoring, authentication / multi-user, private repositories, any GitHub write (issues, PRs, merges), paging beyond the latest 30 items, ETag/304, estimating work time from GitHub history, drag and drop on the board, notifications/webhooks, server-side database (Supabase etc.), CSV export.

## Open items (owner decisions)
- Fixes for the findings in `docs/review-v0.1.md` (none applied in Phase 1D by instruction).
- Whether to set `GITHUB_TOKEN` on Netlify (raises the rate limit from 60/h; not tested).
- Release approval, PR and tag creation.
