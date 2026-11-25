import { test, expect } from '@playwright/test';
import { addAgent, addProject, addTask, editProjectRepo, fulfillJson, nav, seedOnce, snapshotFor, snapshotKeys } from './helpers';
import { readFileSync } from 'node:fs';

const mockRepoSnapshots = (page: import('@playwright/test').Page) =>
  page.route('**/api/github-snapshot*', (route) => fulfillJson(route, 200, snapshotFor(new URL(route.request().url()).searchParams.get('repo')!)));

test.describe('GitHub cache integrity', () => {
  test('changing the repository removes the old cache and never shows it', async ({ page }) => {
    await mockRepoSnapshots(page);
    await page.goto('/');
    await addProject(page, 'Lab', 'o/old');
    await nav(page, 'GitHub連携');
    await page.getByRole('button', { name: '手動で同期' }).click();
    await expect(page.getByTestId('issue-list')).toContainText('issue of o/old');
    expect(await snapshotKeys(page)).toHaveLength(1);

    await editProjectRepo(page, 'Lab', 'o/new');
    await nav(page, 'GitHub連携');
    await expect(page.getByTestId('sync-status')).toHaveText('未取得');
    await expect(page.getByText('issue of o/old')).toHaveCount(0);
    expect(await snapshotKeys(page)).toHaveLength(0);
    await nav(page, 'ダッシュボード');
    await expect(page.getByTestId('last-sync')).toHaveText('—');

    await nav(page, 'GitHub連携');
    await page.getByRole('button', { name: '手動で同期' }).click();
    await expect(page.getByTestId('issue-list')).toContainText('issue of o/new');
  });

  test('project deleted while a sync is in flight: the late result is not stored', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let hit = 0;
    await page.route('**/api/github-snapshot*', async (route) => { hit++; await gate; await fulfillJson(route, 200, snapshotFor('o/old')); });
    await page.goto('/');
    await addProject(page, 'Doomed', 'o/old');
    await nav(page, 'プロジェクト');
    await page.getByRole('button', { name: 'GitHub同期（手動）' }).click();
    await expect.poll(() => hit).toBeGreaterThan(0);
    await page.getByRole('button', { name: '削除', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click();
    await expect(page.getByTestId('project-name')).toHaveCount(0);
    release();
    await page.waitForTimeout(500);
    expect(await snapshotKeys(page)).toHaveLength(0);
    await expect(page.getByText('同期に失敗')).toHaveCount(0);
    await page.reload();
    expect(await snapshotKeys(page)).toHaveLength(0);
  });

  test('repository changed while a sync is in flight: the old repo result is discarded', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let hit = 0;
    await page.route('**/api/github-snapshot*', async (route) => { hit++; const repo = new URL(route.request().url()).searchParams.get('repo')!; await gate; await fulfillJson(route, 200, snapshotFor(repo)); });
    await page.goto('/');
    await addProject(page, 'Lab', 'o/old');
    await nav(page, 'プロジェクト');
    await page.getByRole('button', { name: 'GitHub同期（手動）' }).click();
    await expect.poll(() => hit).toBeGreaterThan(0);
    await editProjectRepo(page, 'Lab', 'o/new');
    release();
    await page.waitForTimeout(500);
    await nav(page, 'GitHub連携');
    await expect(page.getByText('issue of o/old')).toHaveCount(0);
    await expect(page.getByTestId('sync-status')).toHaveText('未取得');
    expect(await snapshotKeys(page)).toHaveLength(0);
  });

  test('restoring a backup purges a cache that does not match the restored project', async ({ page }, info) => {
    await mockRepoSnapshots(page);
    await page.goto('/');
    await addProject(page, 'Lab', 'o/a');
    await nav(page, 'データ管理');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSONをダウンロード' }).click()]);
    const file = info.outputPath('b.json');
    await dl.saveAs(file);
    await editProjectRepo(page, 'Lab', 'o/b');
    await nav(page, 'GitHub連携');
    await page.getByRole('button', { name: '手動で同期' }).click();
    await expect(page.getByTestId('issue-list')).toContainText('issue of o/b');
    await nav(page, 'データ管理');
    await page.getByTestId('restore-input').setInputFiles(file);
    await page.getByRole('dialog').getByRole('button', { name: '復元する' }).click();
    await expect(page.getByText('復元しました。')).toBeVisible();
    await nav(page, 'GitHub連携');
    await expect(page.getByText('issue of o/b')).toHaveCount(0);
    await expect(page.getByTestId('sync-status')).toHaveText('未取得');
    expect(await snapshotKeys(page)).toHaveLength(0);
  });
});

test.describe('approved task editing', () => {
  async function approvedTask(page: import('@playwright/test').Page) {
    await page.goto('/');
    await addProject(page, 'P');
    await addAgent(page, 'Claude');
    await addTask(page, 'T1');
    const card = () => page.getByTestId('task-card').filter({ hasText: /T1|T2/ });
    await card().getByRole('combobox').selectOption({ label: '承認待ち' });
    await card().getByRole('button', { name: '承認する' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '承認して完了にする' }).click();
    await expect(page.getByTestId('col-done').getByText('T1')).toBeVisible();
    return card;
  }

  test('substantive edit: warned up front, confirmed, approval revoked, re-approval required', async ({ page }) => {
    const card = await approvedTask(page);
    await card().getByRole('button', { name: '編集' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText('このタスクは家主承認済みです');
    await dlg.getByLabel('タスク名').fill('T2');
    await dlg.getByRole('button', { name: '保存' }).click();
    const confirm = page.getByRole('dialog', { name: '承認が取り消されます' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'キャンセル' }).click();
    await page.getByRole('dialog', { name: 'タスクを編集' }).getByRole('button', { name: 'キャンセル' }).click();
    await expect(page.getByTestId('col-done').getByText('T1')).toBeVisible(); // nothing changed

    await card().getByRole('button', { name: '編集' }).click();
    await page.getByRole('dialog').getByLabel('タスク名').fill('T2');
    await page.getByRole('dialog').getByRole('button', { name: '保存' }).click();
    await page.getByRole('dialog', { name: '承認が取り消されます' }).getByRole('button', { name: '承認を取り消して保存' }).click();
    await expect(page.getByTestId('col-awaiting_owner').getByText('T2')).toBeVisible();
    await expect(card().getByTestId('owner-approval')).toContainText('未承認');
    await page.reload();
    await nav(page, 'タスク');
    await expect(page.getByTestId('col-awaiting_owner').getByText('T2')).toBeVisible();
    await card().getByRole('button', { name: '承認する' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '承認して完了にする' }).click();
    await expect(page.getByTestId('col-done').getByText('T2')).toBeVisible();
  });

  test('assignee-only edit keeps the approval and asks for no confirmation', async ({ page }) => {
    const card = await approvedTask(page);
    await card().getByRole('button', { name: '編集' }).click();
    await page.getByRole('dialog').getByLabel('AI担当者').selectOption({ label: 'Claude' });
    await page.getByRole('dialog').getByRole('button', { name: '保存' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('col-done').getByText('T1')).toBeVisible();
    await expect(card().getByTestId('owner-approval')).toContainText('承認済み');
  });

  test('card shows GitHub state and owner approval separately; unset links are explicit', async ({ page }) => {
    await page.route('**/api/github-snapshot*', (route) => fulfillJson(route, 200, snapshotFor('pofuru-web/ai-dev-lab-public')));
    await page.goto('/');
    await addProject(page, 'Lab', 'pofuru-web/ai-dev-lab-public');
    await addTask(page, '未設定');
    await expect(page.getByTestId('gh-links')).toContainText('Issue: 紐付けなし');
    await expect(page.getByTestId('gh-links')).toContainText('PR: 紐付けなし');
    await nav(page, 'GitHub連携');
    await page.getByRole('button', { name: '手動で同期' }).click();
    await expect(page.getByTestId('sync-status')).toHaveText('同期済み');
    await nav(page, 'タスク');
    await page.getByRole('button', { name: 'タスクを追加' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('タスク名').fill('PRあり');
    await dlg.getByLabel('PR番号（手動紐付け）').fill('2');
    await dlg.getByRole('button', { name: '保存' }).click();
    const c = page.getByTestId('task-card').filter({ hasText: 'PRあり' });
    await expect(c.getByTestId('gh-links')).toContainText('マージ済み');
    await expect(c.getByTestId('owner-approval')).toContainText('未承認'); // merged on GitHub != approved by the owner
  });
});

test.describe('agents', () => {
  test('multiple roles, new kinds, editing keeps links', async ({ page }) => {
    await page.goto('/');
    await addProject(page, 'P');
    await nav(page, '担当者');
    await page.getByLabel('名前').fill('GPT');
    await page.getByLabel('種別').selectOption({ label: 'ChatGPT' });
    await page.getByLabel('レビュー').check();
    await page.getByLabel('仕様策定・設計').check();
    await page.getByRole('button', { name: '追加', exact: true }).click();
    const row = page.locator('li', { has: page.getByTestId('agent-name') });
    await expect(row).toContainText('ChatGPT');
    await expect(row).toContainText('開発・実装');
    await expect(row).toContainText('レビュー');
    await expect(row).toContainText('仕様策定・設計');
    const idBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('adc:local:v1')!).agents[0].id);

    await addTask(page, 'T');
    await page.getByTestId('task-card').getByRole('button', { name: '編集' }).click();
    await page.getByRole('dialog').getByLabel('AI担当者').selectOption({ label: 'GPT' });
    await page.getByRole('dialog').getByRole('button', { name: '保存' }).click();

    await nav(page, '担当者');
    await row.getByRole('button', { name: '編集' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('名前').fill('GPT-5');
    await dlg.getByLabel('種別').selectOption({ label: 'Gemini' });
    await dlg.getByLabel('開発・実装').uncheck();
    await dlg.getByLabel('テスト・品質管理').check();
    await dlg.getByRole('button', { name: '保存' }).click();
    await expect(row).toContainText('GPT-5');
    await expect(row).toContainText('Gemini');
    await expect(row).toContainText('テスト・品質管理');
    await expect(row).not.toContainText('開発・実装');
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('adc:local:v1')!));
    expect(after.agents[0].id).toBe(idBefore);
    expect(after.tasks[0].assigneeAgentId).toBe(idBefore);
    await nav(page, 'タスク');
    await expect(page.getByTestId('task-card')).toContainText('GPT-5');
  });

  test('at least one role is required', async ({ page }) => {
    await page.goto('/');
    await nav(page, '担当者');
    await page.getByLabel('名前').fill('X');
    await page.getByLabel('開発・実装').uncheck();
    await page.getByRole('button', { name: '追加', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('役割を1つ以上');
  });
});

test.describe('work sessions: dates, editing, periods', () => {
  test('date entry, edit, and period switching', async ({ page }) => {
    await page.goto('/');
    await addProject(page, 'P');
    await addAgent(page, 'Claude');
    await nav(page, '作業時間');
    const reg = () => page.getByRole('button', { name: '登録', exact: true }).click();
    const dur = page.getByRole('textbox', { name: '所要時間（分）' });
    const hours = page.getByTestId('hours-by-project');

    await dur.fill('30'); await reg();                       // date field defaults to today
    await page.locator('input[type=date]').fill('2000-01-01');
    await dur.fill('60'); await reg();
    await page.locator('input[type=date]').fill('');
    await dur.fill('5'); await reg();                        // undated

    await expect(hours).toContainText('1時間35分');          // all-time
    await page.getByRole('button', { name: '今日' }).click();
    await expect(hours).toContainText('30分');
    await expect(hours).not.toContainText('1時間');
    await expect(page.getByText('日付のない記録 1 件は期間別集計に含まれません')).toBeVisible();
    await page.getByRole('button', { name: '今週' }).click();
    await expect(hours).toContainText('30分');
    await page.getByRole('button', { name: '今月' }).click();
    await expect(hours).toContainText('30分');
    await page.getByRole('button', { name: '全期間' }).click();
    await expect(hours).toContainText('1時間35分');

    // edit: move the 60-minute record into today and change it to 45 minutes
    const row = page.getByTestId('session-row').filter({ hasText: '2000-01-01' });
    await row.getByRole('button', { name: '編集' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.locator('input[type=date]').fill(await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }));
    await dlg.getByRole('textbox', { name: '所要時間（分）' }).fill('45');
    await dlg.getByRole('button', { name: '保存' }).click();
    await page.getByRole('button', { name: '今日' }).click();
    await expect(hours).toContainText('1時間15分');
    await page.reload();
    await nav(page, '作業時間');
    await page.getByRole('button', { name: '全期間' }).click();
    await expect(hours).toContainText('1時間20分');

    // invalid edit is rejected and nothing changes
    await page.getByTestId('session-row').first().getByRole('button', { name: '編集' }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: '所要時間（分）' }).fill('0');
    await page.getByRole('dialog').getByRole('button', { name: '保存' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('1以上の整数');
  });
});

test.describe('multiple tabs', () => {
  test('a second tab is stopped as soon as another tab saves, and recovers after reload', async ({ context }) => {
    const a = await context.newPage();
    const b = await context.newPage();
    await a.goto('/');
    await b.goto('/');
    await addProject(a, 'From A');
    await expect(b.getByTestId('stale-reason')).toContainText('他のタブ');
    await nav(b, 'プロジェクト');
    await expect(b.getByRole('button', { name: 'プロジェクトを登録' })).toBeDisabled();
    await b.getByRole('button', { name: '最新のデータを読み込む' }).click();
    await nav(b, 'プロジェクト');
    await expect(b.getByTestId('project-name')).toHaveText('From A');
    await addProject(b, 'From B');
    await expect(b.getByTestId('project-name')).toHaveText(['From A', 'From B']);
    // now A is the stale one
    await expect(a.getByTestId('stale-reason')).toBeVisible();
    const stored = await a.evaluate(() => JSON.parse(localStorage.getItem('adc:local:v1')!).projects.map((p: { name: string }) => p.name));
    expect(stored).toEqual(['From A', 'From B']);
  });

  test('even without the storage event, a stale tab cannot overwrite: the save is refused', async ({ context }) => {
    const a = await context.newPage();
    const b = await context.newPage();
    await b.addInitScript(() => {
      const orig = window.addEventListener.bind(window);
      window.addEventListener = ((type: string, ...rest: unknown[]) => (type === 'storage' ? undefined : (orig as (...a: unknown[]) => void)(type, ...rest))) as typeof window.addEventListener;
    });
    await a.goto('/');
    await b.goto('/');
    await addProject(a, 'From A');
    const before = await a.evaluate(() => localStorage.getItem('adc:local:v1'));
    await nav(b, 'プロジェクト');
    await expect(b.getByRole('button', { name: 'プロジェクトを登録' })).toBeEnabled(); // B has not noticed
    await b.getByRole('button', { name: 'プロジェクトを登録' }).click();
    await b.getByRole('dialog').getByLabel('プロジェクト名').fill('From B (stale)');
    await b.getByRole('dialog').getByRole('button', { name: '保存' }).click();
    await expect(b.getByRole('dialog').getByRole('alert')).toContainText('他のタブ');
    expect(await b.evaluate(() => localStorage.getItem('adc:local:v1'))).toBe(before); // A's data untouched, byte for byte
    await b.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click();
    await expect(b.getByTestId('stale-reason')).toBeVisible();
    await expect(b.getByRole('button', { name: 'プロジェクトを登録' })).toBeDisabled();
    // backup is still downloadable from the stale tab
    await nav(b, 'データ管理');
    const [dl] = await Promise.all([b.waitForEvent('download'), b.getByRole('button', { name: 'JSONをダウンロード' }).click()]);
    expect(dl.suggestedFilename()).toContain('backup');
  });
});

test.describe('migration from schema v1', () => {
  const T = '2026-01-01T00:00:00.000Z';
  const v1 = () => ({
    schemaVersion: 1,
    projects: [{ id: 'p1', name: '旧プロジェクト', status: 'active', createdAt: T, updatedAt: T }],
    agents: [{ id: 'a1', name: '旧担当者', kind: 'codex-cloud', role: 'reviewer' }],
    tasks: [{ id: 't1', projectId: 'p1', title: '旧タスク', status: 'todo', links: {}, ownerApproved: false, createdAt: T, updatedAt: T }],
    workSessions: [{ id: 'w1', projectId: 'p1', agentId: 'a1', durationMinutes: 90, source: 'manual' }],
  });

  test('old data is shown migrated, untouched until the first save, which keeps a raw copy', async ({ page }) => {
    const raw = JSON.stringify(v1());
    await seedOnce(page, 'adc:local:v1', raw);
    await page.goto('/');
    await expect(page.getByText('旧形式のデータを新形式に変換して表示しています')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('adc:local:v1'))).toBe(raw); // not written yet
    await nav(page, '担当者');
    await expect(page.getByTestId('agent-name')).toHaveText('旧担当者');
    await expect(page.locator('li', { has: page.getByTestId('agent-name') })).toContainText('レビュー');
    await nav(page, '作業時間');
    await expect(page.getByTestId('session-row')).toContainText('日付なし'); // no invented date
    await expect(page.getByTestId('hours-by-project')).toContainText('1時間30分');
    await page.getByRole('button', { name: '今日' }).click();
    await expect(page.getByTestId('hours-by-project')).toContainText('記録なし');

    await addProject(page, '新プロジェクト'); // first save
    const stored = await page.evaluate(() => ({ main: JSON.parse(localStorage.getItem('adc:local:v1')!), pre: localStorage.getItem('adc:premigration:v1') }));
    expect(stored.main.schemaVersion).toBe(2);
    expect(stored.main.agents[0].roles).toEqual(['reviewer']);
    expect(stored.main.agents[0]).not.toHaveProperty('role');
    expect(stored.main.workSessions[0]).not.toHaveProperty('workDate');
    expect(stored.pre).toBe(raw);
    await page.reload();
    await expect(page.getByText('旧形式のデータを新形式に変換して表示しています')).toHaveCount(0);
    await nav(page, 'プロジェクト');
    await expect(page.getByTestId('project-name')).toHaveText(['旧プロジェクト', '新プロジェクト']);
  });

  test('migration failure: data untouched, editing blocked, raw data can be downloaded', async ({ page }, info) => {
    const bad = v1(); (bad.agents[0] as Record<string, unknown>).role = 'wizard';
    const raw = JSON.stringify(bad);
    await seedOnce(page, 'adc:local:v1', raw);
    await page.goto('/');
    await expect(page.getByText('旧形式のデータを新形式に変換できませんでした')).toBeVisible();
    await nav(page, 'プロジェクト');
    await expect(page.getByRole('button', { name: 'プロジェクトを登録' })).toBeDisabled();
    await nav(page, 'データ管理');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '保存データ（生）をダウンロード' }).click()]);
    const f = info.outputPath('raw.json');
    await dl.saveAs(f);
    expect(readFileSync(f, 'utf8')).toBe(raw);
    expect(await page.evaluate(() => localStorage.getItem('adc:local:v1'))).toBe(raw);
  });

  test('an old (v1) backup file can be restored', async ({ page }, info) => {
    await page.goto('/');
    await nav(page, 'データ管理');
    await page.getByTestId('restore-input').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'ai-dev-control', exportedAt: T, data: v1() })) });
    await expect(page.getByRole('dialog')).toContainText('復元後: プロジェクト 1');
    await page.getByRole('dialog').getByRole('button', { name: '復元する' }).click();
    await expect(page.getByText('復元しました。')).toBeVisible();
    await nav(page, '担当者');
    await expect(page.locator('li', { has: page.getByTestId('agent-name') })).toContainText('レビュー');
    await page.reload();
    await nav(page, 'プロジェクト');
    await expect(page.getByTestId('project-name')).toHaveText('旧プロジェクト');
    void info;
  });

  test('an unknown newer schema is still read-only and untouched', async ({ page }) => {
    const future = JSON.stringify({ schemaVersion: 3, revision: 0, projects: [], agents: [], tasks: [], workSessions: [] });
    await seedOnce(page, 'adc:local:v1', future);
    await page.goto('/');
    await expect(page.getByText('読み取り専用モード')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('adc:local:v1'))).toBe(future);
  });
});
