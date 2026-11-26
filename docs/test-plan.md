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

## Owner acceptance of Phase 1B (reported by the owner; not run by Claude Code)
- Environment: https://deft-halva-0ad17e.netlify.app/ , verified HEAD `81129eca200b27582d373cbfa4c89bae37491551`.
- Result: all 8 acceptance items passed — agent registration, project registration, real GitHub API sync, task creation and assignment, explicit owner approval, work-time entry reflected on the dashboard, data retained after reload, JSON backup and restore.
- Not covered by that acceptance: multiple tabs, repository changes during sync, editing approved tasks, schema migration (all introduced in Phase 1C).

## Phase 1C additions
- Unit: schema v1->v2 migration (roles, no invented dates, input not mutated, failure paths), loading/saving across the migration (no write on load, raw pre-migration copy before the first save, copy failure aborts the save, existing copies never overwritten), v1 and v2 backups, revision-based conflict detection (nothing written on conflict), agent kinds/multiple roles/edit keeps id, approved-task edit revokes approval (substantive vs assignee-only), work dates/edit/period aggregation (Monday-start week, undated only in all-time), GitHub link display states, snapshot cache integrity.
- Integration: a sync result is discarded when the project/repo changed while the request was in flight; a response for another repository is rejected.
- E2E (Playwright, two tabs in one browser context where needed): cache removed and hidden after repo change; deleted project / changed repo during an in-flight sync; restore purges mismatching cache; approved-task edit flow (warning, confirm, cancel, re-approval); assignee-only edit; agents (new kinds, multiple roles, edit keeps id and links); work-session dates, edit and period switching; two tabs (storage-event path and save-time refusal path); v1 data migration, migration failure (data untouched, raw download), v1 backup restore, newer-schema read-only.
- Existing tests changed because of the spec: see the Phase 1C report (agent `role`->`roles`, revision in saved data, task card wording for approval/GitHub state).
- Still not covered: real-browser timing of two tabs saving in the same instant (localStorage is not mutually exclusive across tabs), Web Locks (not used), Chromium only, real Netlify deployment of Phase 1C.

## Owner acceptance of Phase 1C (reported by the owner; not run by Claude Code)
- Environment: https://deft-halva-0ad17e.netlify.app/ , verified commit `f596c5a` (`f596c5a285ce28f7001f214e9cb87fc273ab1e2b`).
- Result: all 7 items passed — (1) old data carried over without loss, (2) agent editing and multiple roles, (3) work-time editing and period totals, (4) GitHub re-sync, (5) editing an approved task's content returns it to awaiting approval, (6) JSON backup export, (7) a stale tab's save is refused when another tab holds newer data.
- Scope note: this does **not** include verification of exclusion for saves made at exactly the same instant from two tabs. That case is not guaranteed (see data-model.md, multi-tab limit) and remains unverified.

## Phase 1E additions
- Unit (`tests/unit/phase1e.test.ts`, 53 tests): reference/uniqueness checks (10 invalid cases, each also rejected by `parseBackup`, v1 backups, rejection leaves storage byte-identical, stored problems only warned, domain ops never create problems); recovery never overwrites another tab's valid save (also for first save; unreadable value; prev-write race aborts before the main write; own corrupted write still restored); corrupt-value raw copy (next slot, never over an existing copy, no overwrite if the copy fails); task project move blocked with sessions; repository change impact (links cleared, approval revoked, case-only / URL form unchanged, removal, first-time set, other projects untouched).
- E2E (`tests/e2e/release-fixes.spec.ts`, 19 tests): 6 invalid backups rejected with data unchanged, valid backup with unset optional refs restored, stored-data warning and list without modification, task move block (UI + saved data) and normal move, repo change dialog (count, cancel byte-identical, confirm clears links / revokes approval / drops cache), case-only change and no-link project need no dialog, agent/session delete confirmations (cancel / confirm / blocked), corrupt start-fresh copy and refusal when the copy cannot be written.
- Mutation check (manual, this phase): disabling each of the M-1, M-2, M-3, M-5 fixes makes the corresponding tests fail.
- Existing tests: none edited or removed (Vitest 166 and Playwright 29 unchanged and passing).
- Not covered: the read-back race between two real browser tabs (only simulated with an in-memory store), Netlify deployment of Phase 1E, `.nvmrc` effect on Netlify, Chromium only.

## Phase 1E 実環境受入手順（家主向け・Netlify プレビュー）
1. Phase 1E ブランチをデプロイし、**ビルドが成功する**こと（`.nvmrc` の Node 22）と画面が開くことを確認。
2. 先に「データ管理」で現在のデータのバックアップをダウンロード。
3. 既存データが消えずに表示される。「整合性の問題」の警告が出た場合は内容を確認（出ない場合は正常）。
4. GitHub 同期が成功する（Node 22 での Function 動作の確認）。
5. 作業時間のあるタスクの編集画面で、プロジェクトが変更できず理由が出る。作業時間のないタスクは移動できる。
6. 紐付けのあるタスクを持つプロジェクトでリポジトリを変更→確認画面に件数が出る→キャンセルで変化なし→確定で紐付けが外れ、承認済みタスクは「承認待ち」に戻る。大文字小文字だけの変更では確認が出ない。
7. 担当者・作業時間の削除で確認画面が出る（キャンセルで残る）。
8. 不正なバックアップ（ID を重複させた JSON など）を復元しようとすると拒否され、データが変わらない。
9. （任意・要注意）破損データの動作は、必ず事前バックアップを取った上でテスト用ブラウザで確認。

## Phase 1D regression baseline
Vitest 166 and Playwright 29 (Phase 1C) are the baseline; none may be deleted, skipped or loosened. Results of the Phase 1D run are in `docs/release-checklist.md`.
