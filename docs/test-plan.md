# Test plan (Phase 0 draft; no tests have been run for the app because it does not exist yet)

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
