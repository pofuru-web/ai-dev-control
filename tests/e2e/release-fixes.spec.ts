import { test, expect, type Page } from '@playwright/test';
import { fulfillJson, nav, seedOnce, snapshotFor, snapshotKeys } from './helpers';

const T = '2026-01-01T00:00:00.000Z';
const proj = (id: string, name: string, repo?: string) => ({ id, name, status: 'active', ...(repo ? { repo: { owner: repo.split('/')[0], name: repo.split('/')[1] } } : {}), createdAt: T, updatedAt: T });
const agent = (id: string, name: string) => ({ id, name, kind: 'other', roles: ['developer'] });
const task = (id: string, projectId: string, title: string, extra: Record<string, unknown> = {}) => ({ id, projectId, title, status: 'todo', links: {}, ownerApproved: false, createdAt: T, updatedAt: T, ...extra });
interface Doc { schemaVersion: number; revision: number; projects: unknown[]; agents: unknown[]; tasks: Record<string, unknown>[]; workSessions: unknown[] }
const data = (over: Partial<Doc> = {}): Doc => ({ schemaVersion: 2, revision: 0, projects: [], agents: [], tasks: [], workSessions: [], ...over });
const stored = (page: Page, key = 'adc:local:v1') => page.evaluate((k) => localStorage.getItem(k), key);

async function restoreFile(page: Page, name: string, content: string) {
  await nav(page, 'データ管理');
  await page.getByTestId('restore-input').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(content) });
}

test.describe('M-1 integrity checks on restore and load', () => {
  const seeded = data({ projects: [proj('p1', 'Keep')], agents: [agent('a1', 'A')], tasks: [task('t1', 'p1', 'T')] });

  for (const [label, mutate] of [
    ['duplicate project ids', (d: Doc) => { d.projects.push(proj('p1', 'Dup')); }],
    ['duplicate task ids', (d: Doc) => { d.tasks.push(task('t1', 'p1', 'Dup')); }],
    ['a task pointing at a missing project', (d: Doc) => { d.tasks.push(task('t9', 'ghost', 'Orphan')); }],
    ['a task assigned to a missing agent', (d: Doc) => { d.tasks.push(task('t9', 'p1', 'Orphan', { assigneeAgentId: 'ghost' })); }],
    ['a work session pointing at a missing agent', (d: Doc) => { d.workSessions.push({ id: 'w1', projectId: 'p1', agentId: 'ghost', durationMinutes: 5, source: 'manual' }); }],
    ['a work session whose task belongs to another project', (d: Doc) => { d.projects.push(proj('p2', 'Q')); d.workSessions.push({ id: 'w1', projectId: 'p2', agentId: 'a1', taskId: 't1', durationMinutes: 5, source: 'manual' }); }],
  ] as const) {
    test(`a backup with ${label} is rejected and existing data is unchanged`, async ({ page }) => {
      await seedOnce(page, 'adc:local:v1', JSON.stringify(seeded));
      await page.goto('/');
      const bad = JSON.parse(JSON.stringify(seeded)); mutate(bad);
      const before = await stored(page);
      await restoreFile(page, 'bad.json', JSON.stringify({ app: 'ai-dev-control', exportedAt: T, data: bad }));
      await expect(page.getByText('復元できません').first()).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await stored(page)).toBe(before);
      await nav(page, 'プロジェクト');
      await expect(page.getByTestId('project-name')).toHaveText('Keep');
    });
  }

  test('a valid backup with optional references unset still restores', async ({ page }) => {
    await page.goto('/');
    const ok = data({ projects: [proj('p1', 'Restored')], agents: [agent('a1', 'A')], tasks: [task('t1', 'p1', 'T')], workSessions: [{ id: 'w1', projectId: 'p1', agentId: 'a1', durationMinutes: 5, source: 'manual' }] });
    await restoreFile(page, 'ok.json', JSON.stringify({ app: 'ai-dev-control', exportedAt: T, data: ok }));
    await page.getByRole('dialog').getByRole('button', { name: '復元する' }).click();
    await expect(page.getByText('復元しました。')).toBeVisible();
  });

  test('already-stored data with problems: warned, listed, untouched, backup possible', async ({ page }) => {
    const broken = data({ projects: [proj('p1', 'Kept')], tasks: [task('t1', 'ghost', 'Orphan task')] });
    const raw = JSON.stringify(broken);
    await seedOnce(page, 'adc:local:v1', raw);
    await page.goto('/');
    await expect(page.getByText('保存データに整合性の問題があります（1件）')).toBeVisible();
    expect(await stored(page)).toBe(raw);
    await nav(page, 'データ管理');
    await expect(page.getByTestId('integrity-list')).toContainText('unknown projectId "ghost"');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSONをダウンロード' }).click()]);
    expect(dl.suggestedFilename()).toContain('backup');
    expect(await stored(page)).toBe(raw);
    await nav(page, 'プロジェクト');
    await expect(page.getByTestId('project-name')).toHaveText('Kept'); // nothing deleted
  });

  test('no warning for consistent data', async ({ page }) => {
    await seedOnce(page, 'adc:local:v1', JSON.stringify(seeded));
    await page.goto('/');
    await expect(page.getByText('整合性の問題')).toHaveCount(0);
  });
});

test.describe('M-3 task project move with work sessions', () => {
  const seed = data({
    projects: [proj('p1', 'P1'), proj('p2', 'P2')], agents: [agent('a1', 'A')],
    tasks: [task('t1', 'p1', 'with time'), task('t2', 'p1', 'no time')],
    workSessions: [{ id: 'w1', projectId: 'p1', agentId: 'a1', taskId: 't1', durationMinutes: 30, source: 'manual' }],
  });
  test('blocked with a reason in the UI; sessions untouched; other edits still work', async ({ page }) => {
    await seedOnce(page, 'adc:local:v1', JSON.stringify(seed));
    await page.goto('/');
    await nav(page, 'タスク');
    const card = page.getByTestId('task-card').filter({ hasText: 'with time' });
    await card.getByRole('button', { name: '編集' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByTestId('move-blocked')).toContainText('作業時間が 1 件記録されている');
    await expect(dlg.getByLabel('プロジェクト')).toBeDisabled();
    await dlg.getByLabel('タスク名').fill('renamed');
    await dlg.getByRole('button', { name: '保存' }).click();
    await expect(page.getByTestId('task-card').filter({ hasText: 'renamed' })).toBeVisible();
    const after = JSON.parse((await stored(page))!);
    expect(after.workSessions).toEqual(seed.workSessions);
    expect(after.tasks[0].projectId).toBe('p1');
  });
  test('a task without work sessions can still be moved', async ({ page }) => {
    await seedOnce(page, 'adc:local:v1', JSON.stringify(seed));
    await page.goto('/');
    await nav(page, 'タスク');
    await page.getByTestId('task-card').filter({ hasText: 'no time' }).getByRole('button', { name: '編集' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByTestId('move-blocked')).toHaveCount(0);
    await expect(dlg.getByLabel('プロジェクト')).toBeEnabled();
    await dlg.getByLabel('プロジェクト').selectOption({ label: 'P2' });
    await dlg.getByRole('button', { name: '保存' }).click();
    const after = JSON.parse((await stored(page))!);
    expect(after.tasks.find((t: { id: string }) => t.id === 't2').projectId).toBe('p2');
  });
});

test.describe('M-5 repository change', () => {
  const seed = () => data({
    projects: [proj('p1', 'Lab', 'o/a'), proj('p2', 'Other', 'o/z')],
    agents: [agent('a1', 'A')],
    tasks: [
      task('t1', 'p1', 'issue-linked', { links: { issueNumber: 1 } }),
      task('t2', 'p1', 'approved-linked', { status: 'done', ownerApproved: true, approvedAt: T, links: { prNumber: 2 } }),
      task('t3', 'p1', 'unlinked'),
      task('t4', 'p2', 'other-project', { links: { issueNumber: 9 } }),
    ],
  });
  const openEdit = async (page: Page, name: string, repo: string) => {
    await nav(page, 'プロジェクト');
    await page.locator('section', { has: page.getByRole('heading', { name }) }).getByRole('button', { name: '編集' }).click();
    await page.getByRole('dialog').getByPlaceholder('owner/name').fill(repo);
    await page.getByRole('dialog').getByRole('button', { name: '保存' }).click();
  };

  test('warns with the affected count, cancel changes nothing, confirm clears links and revokes approval', async ({ page }) => {
    await page.route('**/api/github-snapshot*', (route) => fulfillJson(route, 200, snapshotFor(new URL(route.request().url()).searchParams.get('repo')!)));
    await seedOnce(page, 'adc:local:v1', JSON.stringify(seed()));
    await page.goto('/');
    await nav(page, 'GitHub連携');
    await page.getByRole('button', { name: '手動で同期' }).click();
    await expect(page.getByTestId('sync-status')).toHaveText('同期済み');
    expect(await snapshotKeys(page)).toHaveLength(1);

    const before = await stored(page);
    await openEdit(page, 'Lab', 'o/b');
    const confirm = page.getByRole('dialog', { name: 'リポジトリを変更しますか？' });
    await expect(confirm.getByTestId('repo-change-impact')).toContainText('2 件');
    await expect(confirm).toContainText('すべて解除');
    await expect(confirm).toContainText('1 件は、紐付けが変わるため承認が取り消され');
    await confirm.getByRole('button', { name: 'キャンセル' }).click();
    expect(await stored(page)).toBe(before);                 // cancel: byte-identical
    expect(await snapshotKeys(page)).toHaveLength(1);        // cache untouched too
    await page.getByRole('dialog', { name: 'プロジェクトを編集' }).getByRole('button', { name: 'キャンセル' }).click();

    await openEdit(page, 'Lab', 'o/b');
    await page.getByRole('dialog', { name: 'リポジトリを変更しますか？' }).getByRole('button', { name: 'Issue/PRの紐付けを解除して変更' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const after = JSON.parse((await stored(page))!);
    const t = (id: string) => after.tasks.find((x: { id: string }) => x.id === id);
    expect(after.projects[0].repo).toEqual({ owner: 'o', name: 'b' });
    expect(t('t1').links).toEqual({});
    expect(t('t2').links).toEqual({});
    expect(t('t2')).toMatchObject({ status: 'awaiting_owner', ownerApproved: false });
    expect(t('t3').links).toEqual({});
    expect(t('t4').links).toEqual({ issueNumber: 9 });          // other project untouched
    expect(await snapshotKeys(page)).toHaveLength(0);           // existing cache invalidation kept
    await nav(page, 'タスク');
    await expect(page.getByTestId('col-awaiting_owner').getByText('approved-linked')).toBeVisible();
    await expect(page.getByTestId('task-card').filter({ hasText: 'issue-linked' }).getByTestId('gh-links')).toContainText('紐付けなし');
  });

  test('a case-only change keeps the links and shows no dialog', async ({ page }) => {
    await seedOnce(page, 'adc:local:v1', JSON.stringify(seed()));
    await page.goto('/');
    await openEdit(page, 'Lab', 'O/A');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const after = JSON.parse((await stored(page))!);
    expect(after.tasks[0].links).toEqual({ issueNumber: 1 });
    expect(after.tasks[1]).toMatchObject({ status: 'done', ownerApproved: true });
    expect(after.projects[0].repo).toEqual({ owner: 'O', name: 'A' });
  });

  test('a change on a project whose tasks have no links needs no confirmation', async ({ page }) => {
    const d = seed(); d.tasks = d.tasks.filter((t) => t.projectId === 'p1' && t.id === 't3');
    await seedOnce(page, 'adc:local:v1', JSON.stringify(d));
    await page.goto('/');
    await openEdit(page, 'Lab', 'o/b');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(JSON.parse((await stored(page))!).projects[0].repo).toEqual({ owner: 'o', name: 'b' });
  });
});

test.describe('delete confirmations', () => {
  const seed = data({
    projects: [proj('p1', 'P')], agents: [agent('a1', 'Assignee'), agent('a2', 'Timekeeper')],
    tasks: [task('t1', 'p1', 'T', { assigneeAgentId: 'a1' })],
    workSessions: [{ id: 'w1', projectId: 'p1', agentId: 'a2', durationMinutes: 30, source: 'manual' }],
  });

  test('agent: cancel keeps everything; confirm deletes and unassigns', async ({ page }) => {
    await seedOnce(page, 'adc:local:v1', JSON.stringify(seed));
    await page.goto('/');
    await nav(page, '担当者');
    const row = page.locator('li', { has: page.getByText('Assignee', { exact: true }) });
    const before = await stored(page);
    await row.getByRole('button', { name: '削除' }).click();
    const dlg = page.getByRole('dialog', { name: '担当者を削除しますか？' });
    await expect(dlg).toContainText('1 件は「未割り当て」');
    await dlg.getByRole('button', { name: 'キャンセル' }).click();
    expect(await stored(page)).toBe(before);
    await row.getByRole('button', { name: '削除' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click();
    await expect(page.getByTestId('agent-name')).toHaveText(['Timekeeper']);
    expect(JSON.parse((await stored(page))!).tasks[0].assigneeAgentId).toBeUndefined();
  });

  test('agent with work sessions cannot be deleted even after confirming', async ({ page }) => {
    await seedOnce(page, 'adc:local:v1', JSON.stringify(seed));
    await page.goto('/');
    await nav(page, '担当者');
    await page.locator('li', { has: page.getByText('Timekeeper', { exact: true }) }).getByRole('button', { name: '削除' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click();
    await expect(page.getByRole('alert')).toContainText('作業時間の記録があるため削除できません');
    await expect(page.getByTestId('agent-name')).toHaveCount(2);
  });

  test('work session: cancel keeps it; confirm deletes it', async ({ page }) => {
    await seedOnce(page, 'adc:local:v1', JSON.stringify(seed));
    await page.goto('/');
    await nav(page, '作業時間');
    const before = await stored(page);
    await page.getByTestId('session-row').getByRole('button', { name: '削除' }).click();
    await page.getByRole('dialog', { name: '作業時間の記録を削除しますか？' }).getByRole('button', { name: 'キャンセル' }).click();
    await expect(page.getByTestId('session-row')).toHaveCount(1);
    expect(await stored(page)).toBe(before);
    await page.getByTestId('session-row').getByRole('button', { name: '削除' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click();
    await expect(page.getByTestId('session-row')).toHaveCount(0);
    expect(JSON.parse((await stored(page))!).workSessions).toEqual([]);
  });
});

test.describe('corrupt data protection when starting fresh', () => {
  test('the corrupt original is copied before it is replaced', async ({ page }) => {
    await seedOnce(page, 'adc:local:v1', '{broken');
    await page.goto('/');
    await nav(page, 'データ管理');
    await page.getByRole('button', { name: '空の状態で開始する' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '開始する' }).click();
    await expect(page.getByText('空の状態で開始しました。')).toBeVisible();
    expect(await stored(page, 'adc:corrupt-copy:0')).toBe('{broken');
    expect(JSON.parse((await stored(page))!).schemaVersion).toBe(2);
  });

  test('if the copy cannot be kept, the corrupt original is NOT overwritten', async ({ page }) => {
    await seedOnce(page, 'adc:local:v1', '{broken');
    await page.addInitScript(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k.startsWith('adc:corrupt-copy')) throw new DOMException('quota', 'QuotaExceededError');
        return orig.call(this, k, v);
      };
    });
    await page.goto('/');
    await nav(page, 'データ管理');
    await page.getByRole('button', { name: '空の状態で開始する' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '開始する' }).click();
    await expect(page.getByText('破損している元データの控えを保存できなかった').first()).toBeVisible();
    expect(await stored(page)).toBe('{broken');
    await expect(page.getByRole('button', { name: '空の状態で開始する' })).toBeVisible(); // still in corrupt mode
  });
});
