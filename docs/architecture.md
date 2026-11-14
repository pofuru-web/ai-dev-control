# AI Dev Control v0.1 — Architecture (Phase 0 draft)

Status: design only. Nothing here is implemented. Items marked **[UNVERIFIED]** have not been confirmed by a real run.

## 1. Purpose
A web app that shows the development status of multiple projects worked on by Claude Code Web and Codex Cloud. The final approver is the human owner; AI agents develop and review only.

## 2. Stack
Vite + React + TypeScript, Tailwind CSS, Netlify Functions, localStorage, Vitest + Playwright, GitHub REST API. No dependency on Xcode, Swift or a local Mac.

## 3. Components
```
Browser (React SPA)
 ├─ UI (Dashboard / Project / Task / Session views)
 ├─ LocalStore  (localStorage: user-authored data only)      -> see data-model.md
 ├─ SnapshotCache (localStorage, separate key: GitHub data)  -> never merged into LocalStore
 └─ api client  ──HTTPS──>  Netlify Function /api/github-snapshot
                                  │  (server-side only: GITHUB_TOKEN env, optional)
                                  └──HTTPS──> api.github.com (GET only)
```

## 4. Principles
1. GitHub is read-only. The function exposes GET only and allow-lists the upstream paths (`/repos/{owner}/{repo}`, `/issues`, `/pulls`, `/commits`, `/rate_limit`). No POST/PATCH/PUT/DELETE code path exists.
2. No secrets in the frontend bundle. A token, if any, lives only in Netlify environment variables. Public repos work without a token; a token is only for rate limit headroom.
3. Local data and GitHub data are stored under different keys and different types. GitHub data is a replaceable cache; local data is the source of truth for human decisions.
4. API failure never destroys data. A fetch writes to a temp value, validates, then swaps; on any error the previous snapshot is kept and an error status is stored beside it.
5. Working time of AI is never inferred from GitHub history. Hours are only entered by the human in WorkSession.
6. Out of scope: automatic polling/monitoring, multi-user auth.

## 5. Netlify Function design (`netlify/functions/github-snapshot.ts`)
- Input: `?repo=owner/name` (validated by regex `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`) and an optional server-side allow-list of repos (env `ALLOWED_REPOS`) to prevent use as an open proxy.
- Calls (per_page=30): `GET /repos/{r}`, `GET /repos/{r}/issues?state=all&sort=created&direction=desc`, `GET /repos/{r}/pulls?state=all&sort=created&direction=desc`, `GET /repos/{r}/commits`. Per-PR detail (`GET /pulls/{n}`) only if merged status cannot be derived from list data (see github-integration.md).
- Output: normalized `GitHubSnapshot` JSON plus `rateLimit {limit, remaining, reset}` taken from response headers, and `partialErrors[]`.
- Headers: `User-Agent: ai-dev-control`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`; `Authorization` only if env token exists.
- Conditional requests: forward `If-None-Match` ETag from cache; a 304 does not consume primary rate limit (per GitHub docs, **[UNVERIFIED]** here).
- Errors: map 403/429 with `x-ratelimit-remaining: 0` to `rate_limited` (with reset time), 404 to `not_found`, others to `upstream_error`. Response is always JSON; never leaks the token or upstream raw bodies containing it.
- Response cache header `Cache-Control: private, max-age=60`. Timeout 10 s per upstream call.

## 6. Frontend flow
1. User presses "Refresh" (manual only).
2. Client calls the function, receives snapshot or error.
3. On success: validate shape (type guard), replace SnapshotCache[projectId]. On error: keep old cache, set `lastError`.
4. UI shows `fetchedAt` and a stale badge; local data untouched.

## 7. Directory layout (planned, Phase 1)
```
src/ {components, features/{projects,tasks,sessions,github}, lib/{storage,github-client,dedupe}, types/}
netlify/functions/github-snapshot.ts
tests/unit (Vitest)   tests/e2e (Playwright)
```

## 8. Security notes
- Token never in `VITE_*` variables (those are bundled). 
- CORS: function same-origin only.
- Input validation on `repo`; allow-list; GET-only upstream.
- localStorage is readable by any script on the origin: store no secrets there.
