# GitHub integration (Phase 0 findings and design)

Target: `pofuru-web/ai-dev-lab-public`. GitHub is **read-only**; no Issue/PR creation, no merge, no writes were performed.

## 1. What was actually verified (measured in this session)
Environment: Claude Code cloud container, outbound HTTPS via a managed proxy.

| Check | Result |
|---|---|
| `GET https://api.github.com/rate_limit` | HTTP 200, `x-ratelimit-limit: 15000`, remaining 14979. **This is the proxy's injected credential, NOT an anonymous measurement.** |
| `GET /repos/pofuru-web/ai-dev-lab-public` (and `/issues`, `/pulls`, `/commits`, per_page=30) | **HTTP 403** from the proxy: "GitHub access to this repository is not enabled for this session". After `add_repo` (read) the answer was the same: anonymous read is served for **git clone/fetch only**, not REST. |
| Control: `GET /repos/octocat/Hello-World` | HTTP 403 (same proxy policy) |
| `git clone --depth 1` + `git fetch --depth=1000` of the repo | Success |

Conclusion: **REST retrieval of Issues / PRs / Commits for the target repo could NOT be executed here. Issue/PR/Commit counts via the REST API are unmeasured (0 retrieved).** Obtaining REST access would require attaching the repo with push-level credentials (`add_repo access:"push"`), which conflicts with the read-only rule and was not done.

## 2. What git-level inspection shows (not the REST API)
- Default branch `main`, HEAD `b570006`; 3 commits total (all fetched): `c055024 Initial commit`, `8502517 feat: add CSV worktime reporting CLI`, `b570006 Merge pull request #2 from pofuru-web/codex/issue-1-worktime`.
- Branches on remote: `main`, `codex/issue-1-worktime`.
- Files: README.md, worktime.py, examples/, tests/.
- From the merge commit subject one can *infer* PR #2 was merged and that issue #1 exists. This is an inference from git data, not an API result; Issue/PR titles, states, comments are not available through git.

## 3. Expected API behavior (from GitHub documentation/knowledge; **[UNVERIFIED] in this session**)
- Unauthenticated REST: 60 requests/hour per IP; authenticated token: 5,000/hour. Headers `x-ratelimit-limit/remaining/reset/resource`. 403 or 429 with remaining 0 = rate limited.
- Public repos readable without auth: repo metadata, issues, pulls, commits.
- Paging: `per_page` max 100, `page=N`, `Link: rel="next"` header. Latest 30 = one page each (`per_page=30`); no paging needed for the MVP.
- Ordering: issues/pulls `sort=created&direction=desc`; commits default newest-first.
- Cost for one refresh: 4 calls (repo, issues, pulls, commits), plus up to 30 for PR details if used. Unauth 60/h would allow ~15 refreshes/h without PR details, so a token held server-side is recommended.

## 4. Dedupe and merged detection (design; tests to be written in Phase 1)
- `GET /issues` also returns pull requests (items with a `pull_request` key). Dedupe rule: drop any item having `pull_request` from the issue list; PRs come from `/pulls`. Key = `number` (issues and PRs share one number space within a repo).
- Merged: list `/pulls` items expose `merged_at` (non-null = merged) while `merged` boolean is only on the single-PR endpoint. Rule: `merged = merged_at != null`; `state=closed && merged_at==null` = closed without merge. This avoids N extra calls. **[UNVERIFIED]** against live data; unit tests with recorded fixtures required.
- Commits: key by `sha`; the merge commit and the PR are different entities and are not deduped against each other.

## 5. Safe fetching via Netlify Functions
See architecture.md section 5. Summary: GET-only, repo allow-list, server-side token, no token or raw upstream error in responses, manual refresh only, previous snapshot kept on error.

## 6. Failure handling matrix
| Condition | Behavior |
|---|---|
| 403/429 rate limit | keep cache, show reset time |
| 404 | keep cache, mark project repo invalid |
| network/timeout | keep cache, retry manually |
| any one of the four requests fails | whole fetch fails; nothing is stored; previous snapshot kept (no partial snapshots) |
| malformed JSON | reject, keep cache |

## 6a. Phase 1A update
- The owner reported that all four REST endpoints (repo/issues/pulls/commits) for `pofuru-web/ai-dev-lab-public` rendered in their browser. HTTP headers, Netlify Functions behaviour and data details remain **unverified** by this project.
- This sandbox still returns HTTP 403 for those endpoints (proxy policy), so Phase 1A verified the function against **mocked** upstream responses only. See test-plan.md.
- Implemented: GET-only upstream calls, allow-list (default `pofuru-web/ai-dev-lab-public`), `.`/`..` segment rejection, private repos refused, token from server env only, merged = `merged_at != null` (or explicit `merged` boolean).

## 6b. Phase 1A hardening
- Timeouts: every upstream GET has a 10 s limit (headers and body, `AbortSignal.timeout`); the first failure cancels the other requests; result is `timeout` (HTTP 504). The browser client waits at most 15 s. A timeout never replaces the stored snapshot.
- Strict validation: required fields must be present with the right type; `state` must be exactly `open`/`closed`; PR `merged_at` must be null or a date; a `merged` flag that contradicts `merged_at`, a merged-but-open PR, a closed issue without `closed_at`, non-40-hex shas and invalid dates are rejected as `bad_response` (HTTP 502). Nothing is coerced to a default. Only a null `user` (deleted account) is accepted and stored as an empty author. The client re-validates the snapshot before saving.

## 6c. Owner-measured production verification (Phase 1A deployment)
Reported by the owner (not measured by Claude Code; recorded here as provided):

| Item | Value |
|---|---|
| Deploy URL | https://deft-halva-0ad17e.netlify.app/ |
| Deployed HEAD | 9e225b0b1f4ea937125e7ccb97f0c9a86bc15d61 |
| Function path | /api/github-snapshot |
| Verified at | 2026-11-25 17:15 JST |
| Target | pofuru-web/ai-dev-lab-public |
| GITHUB_TOKEN | not set (unauthenticated upstream) |
| Response | `ok: true` |
| Issues | 1 (#1, closed) |
| Pull requests | 1 (#2, closed, `merged: true`) |
| Commits | 3 |
| rateLimit | limit 60, remaining 56 |
| Strict normalization | accepted the real data without rejection |

This confirms, for this one repository: the Netlify Function runs, unauthenticated GitHub access works with the 60/hour limit, and the strict validators accept real data (including the merged PR and issue/PR dedupe result of 1 issue + 1 PR).

**Still unverified:** paging (`Link` header / more than 30 items), abnormal-case behaviour in the real environment (rate-limit exhaustion, 404, upstream failure, real timeouts), ETag/304 (not implemented), behaviour with `GITHUB_TOKEN` set, and any repository other than the target.

## 6d. Phase 1B owner acceptance (reported by the owner)
Netlify deployment https://deft-halva-0ad17e.netlify.app/ at HEAD `81129eca200b27582d373cbfa4c89bae37491551`: 8/8 acceptance items passed, including a real GitHub API sync from the UI. Paging, real-environment error cases and ETag/304 remain unverified.

## 6e. Phase 1E owner acceptance and Phase 1F cache (summary)
- Phase 1E was accepted by the owner on the deployed site (commit 0824ec9, 8/8 items, including a real manual sync on Node 22). Reported by the owner, not run by Claude Code.
- Phase 1F adds a 60 s CDN cache for successful sync responses only (errors `no-store`, key = `repo` only). Implemented and unit/integration tested; **not verified on Netlify**. See docs/netlify-cache-verification.md. A manual sync can return data up to 60 s old; `fetchedAt` is the real GitHub fetch time.

## 7. Open item to close before Phase 1 coding
Run the 4 calls from an environment with unrestricted GitHub API access (owner's machine or a Netlify deploy preview) and record: counts, headers, `Link` behavior, anonymous limit, PR `merged_at` shape. Section 6c now records the owner's measurement for the target repository; the items listed there as unverified remain open.
