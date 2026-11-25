# Test plan (updated in Phase 1A)

Phase 1B adds UI, storage-guard and domain tests (see below). Phase 1A hardening adds timeout, strict-validation and read-back-recovery tests (95 tests total).

Phase 1A status: unit + integration tests (mocked GitHub) are implemented under `tests/unit` and `tests/integration`; one Playwright smoke test exists. Live-API and deployed-Netlify checks are NOT done. Planned-but-not-implemented items below (304/ETag, timeout, E2E data flows) remain future work.

## Unit (Vitest)
- dedupe: items with `pull_request` removed from issues; shared number space.
- merged detection: merged_at set / null with closed / open.
- normalizers reject malformed payloads.
- storage: atomic write, corrupted JSON fallback, schemaVersion migration, snapshot replace-on-success only.
- WorkSession: type forbids non-manual source; no code derives hours from commits.
- function handler: repo regex, allow-list, GET-only, rate-limit mapping, token never in output (fixtures).

## Integration
- Function against recorded fixtures: 200, 304, 403 rate limit, 404, timeout, partial failure.

## E2E (Playwright, mocked function)
- Create project/task/session; reload; data persists.
- Refresh success updates the GitHub panel; refresh failure keeps old snapshot and shows error.
- Owner approval toggle only via explicit action.

## Security checks
- Grep built bundle for `ghp_`, `github_pat_`, `Authorization`; none allowed.
- No `VITE_` variable holds a secret.
- No upstream non-GET calls (static check + unit test).

## Live verification (manual, before Phase 1 coding)
Real calls to `pofuru-web/ai-dev-lab-public`: counts, headers, Link paging, unauthenticated limit. **Status: NOT DONE in Phase 0 (blocked by sandbox proxy).**

## Exit criteria for MVP
All unit/integration green, E2E green, typecheck + lint clean, security checks pass, live verification recorded.

## Phase 1B additions
- Unit: pre-write protection (aborts on unreadable existing data; never overwrites a newer schemaVersion in main or prev), approval invariant (done <=> approved), domain operations (projects/agents/tasks/approval/work sessions/aggregation/dashboard).
- E2E (Playwright, GitHub function mocked with `page.route`): persistence across reload, task status changes, explicit approval (cancel/confirm, revocation on leaving done), manual work-time aggregation, backup download / invalid file / confirm-then-restore, GitHub sync success/failure/rate-limit with old data retained, syncing state, manual Issue/PR link resolution, save failure UI and recovery, newer-schema read-only, corrupt-data flow, mobile and desktop layout.
- Not covered: real deployed Function from E2E, paging, real-environment error cases, cross-browser (Chromium only), accessibility audit.
