# ai-dev-control

Phase 1A foundation. See `docs/`.

```bash
npm install
npm run typecheck && npm run lint && npm test && npm run build
npm run test:e2e   # set PW_CHROMIUM_PATH to reuse a preinstalled Chromium
```

Server-side env (never `VITE_*`): `GITHUB_TOKEN` (optional), `ALLOWED_REPOS`. See `.env.example`.
