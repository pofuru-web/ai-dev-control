import { expect, type Page, type Route } from '@playwright/test';

export const nav = (page: Page, label: string) => page.getByRole('navigation').getByRole('link', { name: label }).click();

export async function addProject(page: Page, name: string, repo = '') {
  await nav(page, 'プロジェクト');
  await page.getByRole('button', { name: 'プロジェクトを登録' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('プロジェクト名').fill(name);
  if (repo) await dlg.getByPlaceholder('owner/name').fill(repo);
  await dlg.getByRole('button', { name: '保存' }).click();
}

export async function addAgent(page: Page, name: string) {
  await nav(page, '担当者');
  await page.getByLabel('名前').fill(name);
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByTestId('agent-name').filter({ hasText: name })).toBeVisible();
}

export async function addTask(page: Page, title: string, agent = '') {
  await nav(page, 'タスク');
  await page.getByRole('button', { name: 'タスクを追加' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('タスク名').fill(title);
  if (agent) await dlg.getByLabel('AI担当者').selectOption({ label: agent });
  await dlg.getByRole('button', { name: '保存' }).click();
}

export const snapshotJson = (over: Record<string, unknown> = {}) => ({
  ok: true,
  snapshot: {
    repo: 'pofuru-web/ai-dev-lab-public',
    fetchedAt: '2026-11-25T08:15:00.000Z',
    info: { fullName: 'pofuru-web/ai-dev-lab-public', defaultBranch: 'main', private: false, htmlUrl: 'https://github.com/pofuru-web/ai-dev-lab-public' },
    issues: [{ number: 1, title: 'worktime issue', state: 'closed', author: 'pofuru-web', createdAt: '2026-11-06T00:00:00Z', closedAt: '2026-11-06T01:00:00Z', url: 'https://github.com/pofuru-web/ai-dev-lab-public/issues/1', labels: [] }],
    pulls: [{ number: 2, title: 'worktime PR', state: 'closed', merged: true, mergedAt: '2026-11-06T02:00:00Z', author: 'pofuru-web', head: 'codex/issue-1-worktime', base: 'main', createdAt: '2026-11-06T00:30:00Z', url: 'https://github.com/pofuru-web/ai-dev-lab-public/pull/2' }],
    commits: ['a', 'b', 'c'].map((c, i) => ({ sha: c.repeat(40), message: `commit ${i}`, author: 'pofuru-web', committedAt: `2026-11-06T0${i}:00:00Z`, url: `https://github.com/pofuru-web/ai-dev-lab-public/commit/${c.repeat(40)}` })),
    rateLimit: { limit: 60, remaining: 56, resetAt: '2026-11-25T09:00:00.000Z' },
    ...over,
  },
});

export const fulfillJson = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Seeds localStorage once per tab (survives reloads without being re-applied). */
export async function seedOnce(page: Page, key: string, value: string) {
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded:' + k)) { localStorage.setItem(k as string, v as string); sessionStorage.setItem('seeded:' + k, '1'); } }, [key, value]);
}

export const snapshotFor = (repo: string) => {
  const j = snapshotJson();
  const s = j.snapshot as Record<string, unknown>;
  s.repo = repo;
  (s.info as Record<string, unknown>).fullName = repo;
  (s.issues as { title: string }[])[0]!.title = `issue of ${repo}`;
  return j;
};

export async function editProjectRepo(page: Page, name: string, repo: string) {
  await nav(page, 'プロジェクト');
  const card = page.locator('section', { has: page.getByRole('heading', { name }) });
  await card.getByRole('button', { name: '編集' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByPlaceholder('owner/name').fill(repo);
  await dlg.getByRole('button', { name: '保存' }).click();
  await expect(dlg).toHaveCount(0);
}

export const snapshotKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('adc:snapshot:')));
