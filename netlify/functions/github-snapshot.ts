import { createHandler } from '../../src/lib/github/handler';

// Netlify Functions v2. Env vars are server-side only.
export default async (req: Request): Promise<Response> =>
  createHandler({
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    ALLOWED_REPOS: process.env.ALLOWED_REPOS,
  })(req);

export const config = { path: '/api/github-snapshot' };
