import { test, expect } from '@playwright/test';
import { addAgent, addProject, addTask, fulfillJson, nav, snapshotJson } from './helpers';
import { readFileSync } from 'node:fs';

test.describe('persistence and task flow', () => {
  test('data survives a reload and shows on the dashboard', async ({ page }) => {
    await page.goto('/');
    await addProject(page, '永続化テスト');
    await addAgent(page, 'Claude');
    await addTask(page, 'タスクA', 'Claude');
    await page.reload();
    await nav(page, 'プロジェクト');
    await expect(page.getByTestId('project-name')).toHaveText('永続化テスト');
    await nav(page, 'タスク');
    await expect(page.getByTestId('col-todo').getByText('タスクA')).toBeVisible();
    await nav(page, 'ダッシュボード');
    await expect(page.getByTestId('stat-projects')).toHaveText('1');
    await expect(page.getByRole('cell', { name: 'Claude' })).toBeVisible();
  });

  test('status changes, explicit owner approval, and approval revocation', async ({ page }) => {
    await page.goto('/');
    await addProject(page, 'P');
    await addTask(page, 'T1');
    const card = () => page.getByTestId('task-card').filter({ hasText: 'T1' });
    const move = (label: string) => card().getByRole('combobox').selectOption({ label });

    await move('作業中');
    await expect(page.getByTestId('col-in_progress').getByText('T1')).toBeVisible();
    await move('ブロック中');
    await nav(page, 'ダッシュボード');
    await expect(page.getByTestId('stat-blocked')).toHaveText('1');
    await nav(page, 'タスク');
    await move('承認待ち');
    await nav(page, 'ダッシュボード');
    await expect(page.getByTestId('stat-awaiting')).toHaveText('1');
    await nav(page, 'タスク');

    // 'done' is not selectable from the dropdown: only the explicit approval path exists.
    await expect(card().getByRole('combobox').locator('option', { hasText: '完了' })).toHaveCount(0);

    await card().getByRole('button', { name: '承認する' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click();
    await expect(page.getByTestId('col-awaiting_owner').getByText('T1')).toBeVisible(); // cancel changes nothing

    await card().getByRole('button', { name: '承認する' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '承認して完了にする' }).click();
    await expect(page.getByTestId('col-done').getByText('T1')).toBeVisible();
    await expect(card().getByTestId('owner-approval')).toContainText('承認済み');

    await page.reload();
    await nav(page, 'タスク');
    await expect(page.getByTestId('col-done').getByTestId('owner-approval')).toContainText('承認済み');

    await move('作業中'); // leaving done revokes the approval
    await expect(card().getByTestId('owner-approval')).toContainText('未承認');
    await expect(page.getByTestId('col-in_progress').getByText('T1')).toBeVisible();
  });

  test('manual work sessions are aggregated; no GitHub inference', async ({ page }) => {
    await page.goto('/');
    await addProject(page, 'P');
    await addAgent(page, 'Claude');
    await nav(page, '作業時間');
    await expect(page.getByText('推測することはありません')).toBeVisible();
    await page.getByRole('textbox', { name: '所要時間（分）' }).fill('90');
    await page.getByRole('button', { name: '登録', exact: true }).click();
    await page.getByRole('textbox', { name: '所要時間（分）' }).fill('30');
    await page.getByRole('button', { name: '登録', exact: true }).click();
    await expect(page.getByTestId('hours-by-project')).toContainText('2時間0分');
    await expect(page.getByTestId('hours-by-agent')).toContainText('Claude');
    await page.getByRole('textbox', { name: '所要時間（分）' }).fill('0');
    await page.getByRole('button', { name: '登録', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('1以上の整数');
  });
});

test.describe('backup and restore', () => {
  test('download, wipe, restore with confirmation; invalid file changes nothing', async ({ page }, info) => {
    await page.goto('/');
    await addProject(page, 'バックアップ対象');
    await nav(page, 'データ管理');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSONをダウンロード' }).click()]);
    const file = info.outputPath('backup.json');
    await dl.saveAs(file);
    const json = JSON.parse(readFileSync(file, 'utf8'));
    expect(json.app).toBe('ai-dev-control');
    expect(json.data.projects[0].name).toBe('バックアップ対象');
    expect(JSON.stringify(json)).not.toContain('"issues"'); // no GitHub data in backups

    // delete the project
    await nav(page, 'プロジェクト');
    await page.getByRole('button', { name: '削除', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click();
    await expect(page.getByTestId('project-name')).toHaveCount(0);

    // invalid file: error, nothing changes
    await nav(page, 'データ管理');
    await page.getByTestId('restore-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') });
    await expect(page.getByRole('alert').or(page.getByRole('status')).filter({ hasText: '復元できません' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // valid file: confirmation first, cancel keeps data unchanged
    await page.getByTestId('restore-input').setInputFiles(file);
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText('復元後: プロジェクト 1');
    await dlg.getByRole('button', { name: 'キャンセル' }).click();
    await nav(page, 'プロジェクト');
    await expect(page.getByTestId('project-name')).toHaveCount(0);

    // confirm restore
    await nav(page, 'データ管理');
    await page.getByTestId('restore-input').setInputFiles(file);
    await page.getByRole('dialog').getByRole('button', { name: '復元する' }).click();
    await expect(page.getByText('復元しました。')).toBeVisible();
    await page.reload();
    await nav(page, 'プロジェクト');
    await expect(page.getByTestId('project-name')).toHaveText('バックアップ対象');
  });
});

test.describe('GitHub sync', () => {
  test('success shows data; failure keeps the old data and shows the error', async ({ page }) => {
    let mode: 'ok' | 'rate' | 'bad' = 'ok';
    const requests: string[] = [];
    await page.route('**/api/github-snapshot*', (route) => {
      requests.push(route.request().method() + ' ' + route.request().url());
      if (mode === 'ok') return fulfillJson(route, 200, snapshotJson());
      if (mode === 'rate') return fulfillJson(route, 429, { ok: false, error: { code: 'rate_limited', message: 'x', resetAt: '2026-11-25T09:00:00.000Z' } });
      return fulfillJson(route, 502, { ok: false, error: { code: 'bad_response', message: 'x' } });
    });
    await page.goto('/');
    await addProject(page, 'Lab', 'pofuru-web/ai-dev-lab-public');
    await nav(page, 'GitHub連携');
    await expect(page.getByTestId('sync-status')).toHaveText('未取得');
    await page.getByRole('button', { name: '手動で同期' }).click();
    await expect(page.getByTestId('sync-status')).toHaveText('同期済み');
    await expect(page.getByTestId('issue-list')).toContainText('#1 worktime issue');
    await expect(page.getByTestId('pr-list')).toContainText('マージ済み');
    await expect(page.getByTestId('commit-list').locator('li')).toHaveCount(3);
    await expect(page.getByTestId('rate-limit')).toHaveText('56 / 60');
    const fetchedBefore = await page.getByTestId('fetched-at').textContent();

    for (const m of ['rate', 'bad'] as const) {
      mode = m;
      await page.getByRole('button', { name: '手動で同期' }).click();
      await expect(page.getByTestId('sync-status')).toHaveText('同期失敗');
      await expect(page.getByTestId('sync-error')).toBeVisible();
      await expect(page.getByText('データは消去されていません')).toBeVisible();
      await expect(page.getByTestId('issue-list')).toContainText('#1 worktime issue'); // old data kept
      await expect(page.getByTestId('fetched-at')).toHaveText(fetchedBefore!);
    }
    // old data also survives a reload after failures
    await page.reload();
    await nav(page, 'GitHub連携');
    await expect(page.getByTestId('pr-list')).toContainText('#2 worktime PR');

    // dashboard shows activity and last sync; only GET requests were made
    await nav(page, 'ダッシュボード');
    await expect(page.getByTestId('last-sync')).not.toHaveText('—');
    await expect(page.getByText('worktime PR')).toBeVisible();
    expect(requests.every((r) => r.startsWith('GET '))).toBe(true);
    expect(requests.length).toBe(3);
  });

  test('a syncing state is shown and a second click is ignored', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/github-snapshot*', async (route) => { calls++; await new Promise((r) => setTimeout(r, 500)); await fulfillJson(route, 200, snapshotJson()); });
    await page.goto('/');
    await addProject(page, 'Lab', 'pofuru-web/ai-dev-lab-public');
    await nav(page, 'GitHub連携');
    await page.getByRole('button', { name: '手動で同期' }).click();
    await expect(page.getByTestId('sync-status')).toHaveText('同期中');
    await expect(page.getByRole('button', { name: '同期中…' })).toBeDisabled();
    await expect(page.getByTestId('sync-status')).toHaveText('同期済み');
    expect(calls).toBe(1);
  });

  test('manual Issue/PR links resolve against the snapshot', async ({ page }) => {
    await page.route('**/api/github-snapshot*', (route) => fulfillJson(route, 200, snapshotJson()));
    await page.goto('/');
    await addProject(page, 'Lab', 'pofuru-web/ai-dev-lab-public');
    await nav(page, 'GitHub連携');
    await page.getByRole('button', { name: '手動で同期' }).click();
    await expect(page.getByTestId('sync-status')).toHaveText('同期済み');
    await nav(page, 'タスク');
    await page.getByRole('button', { name: 'タスクを追加' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('タスク名').fill('紐付け');
    await dlg.getByLabel('Issue番号（手動紐付け）').fill('1');
    await dlg.getByLabel('PR番号（手動紐付け）').fill('2');
    await dlg.getByRole('button', { name: '保存' }).click();
    const links = page.getByTestId('gh-links');
    await expect(links).toContainText('Issue #1: クローズ');
    await expect(links).toContainText('PR #2: マージ済み');
  });
});

test.describe('storage problems', () => {
  test('save failure: error + guidance, nothing half-applied, recovers afterwards', async ({ page }) => {
    await page.addInitScript(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        if ((window as unknown as { __failSave?: boolean }).__failSave && k === 'adc:local:v1') throw new DOMException('quota', 'QuotaExceededError');
        return orig.call(this, k, v);
      };
    });
    await page.goto('/');
    await addProject(page, '既存');
    await page.evaluate(() => { (window as unknown as { __failSave: boolean }).__failSave = true; });
    await nav(page, 'プロジェクト');
    await page.getByRole('button', { name: 'プロジェクトを登録' }).click();
    await page.getByRole('dialog').getByLabel('プロジェクト名').fill('失敗する追加');
    await page.getByRole('dialog').getByRole('button', { name: '保存' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('保存に失敗しました');
    await expect(page.getByTestId('save-problem')).toContainText('保存に失敗しました');
    await expect(page.getByTestId('save-recovery')).toContainText('直前のデータは保持されています');
    await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click();
    await expect(page.getByTestId('project-name')).toHaveText(['既存']);
    // backup is still possible from memory
    await nav(page, 'データ管理');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSONをダウンロード' }).click()]);
    expect(dl.suggestedFilename()).toContain('ai-dev-control-backup');
    // recovers when storage works again
    await page.evaluate(() => { (window as unknown as { __failSave: boolean }).__failSave = false; });
    await addProject(page, '成功する追加');
    await expect(page.getByTestId('project-name')).toHaveText(['既存', '成功する追加']);
    await page.reload();
    await nav(page, 'プロジェクト');
    await expect(page.getByTestId('project-name')).toHaveText(['既存', '成功する追加']);
  });

  test('newer schemaVersion: read-only, nothing is overwritten', async ({ page }) => {
    const future = JSON.stringify({ schemaVersion: 99, projects: [], agents: [], tasks: [], workSessions: [], extra: 'keep-me' });
    await page.addInitScript((v) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('adc:local:v1', v); sessionStorage.setItem('seeded', '1'); } }, future);
    await page.goto('/');
    await expect(page.getByText('読み取り専用モード')).toBeVisible();
    await nav(page, 'プロジェクト');
    await expect(page.getByRole('button', { name: 'プロジェクトを登録' })).toBeDisabled();
    await nav(page, 'データ管理');
    await expect(page.getByTestId('restore-input')).toBeDisabled();
    expect(await page.evaluate(() => localStorage.getItem('adc:local:v1'))).toBe(future);
  });

  test('corrupt data: editing is blocked until the owner restores or starts fresh', async ({ page }) => {
    await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('adc:local:v1', '{broken'); sessionStorage.setItem('seeded', '1'); } });
    await page.goto('/');
    await expect(page.getByText('保存データを読み込めませんでした').first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('adc:local:v1'))).toBe('{broken');
    await nav(page, 'プロジェクト');
    await expect(page.getByRole('button', { name: 'プロジェクトを登録' })).toBeDisabled();
    await nav(page, 'データ管理');
    await page.getByRole('button', { name: '空の状態で開始する' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '開始する' }).click();
    await expect(page.getByText('空の状態で開始しました。')).toBeVisible();
    await addProject(page, '再開');
    await expect(page.getByTestId('project-name')).toHaveText('再開');
  });
});

test.describe('layout', () => {
  test('mobile: navigation collapses behind a menu button and has no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'タスク' })).toBeHidden();
    await page.getByRole('button', { name: 'メニュー' }).click();
    await page.getByRole('link', { name: 'タスク' }).click();
    await expect(page.getByRole('heading', { name: 'タスク' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
  test('desktop: left navigation is visible', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const box = await page.getByRole('navigation').boundingBox();
    expect(box!.x).toBe(0);
    expect(box!.width).toBeLessThan(300);
  });
});
