import { test, expect } from '@playwright/test';
import { addProject, nav } from './helpers';

test.describe('Issue/PR number inputs are clearly optional examples', () => {
  async function openNewTask(page: import('@playwright/test').Page) {
    await page.goto('/');
    await addProject(page, 'P');
    await nav(page, 'タスク');
    await page.getByRole('button', { name: 'タスクを追加' }).click();
    return page.getByRole('dialog');
  }

  test('new task: placeholders are examples (not look-alike values), hints say optional and unlinked when empty', async ({ page }) => {
    const dlg = await openNewTask(page);
    await expect(dlg.getByLabel('Issue番号（手動紐付け）')).toHaveAttribute('placeholder', '例：1');
    await expect(dlg.getByLabel('PR番号（手動紐付け）')).toHaveAttribute('placeholder', '例：2');
    await expect(dlg.getByLabel('Issue番号（手動紐付け）')).toHaveValue('');
    await expect(dlg).toContainText('任意。未入力ならIssueとは紐付けされません。');
    await expect(dlg).toContainText('任意。未入力ならPRとは紐付けされません。');
  });

  test('leaving them empty links nothing; edit dialog shows the same wording and real values replace the placeholder', async ({ page }) => {
    const dlg = await openNewTask(page);
    await dlg.getByLabel('タスク名').fill('T');
    await dlg.getByRole('button', { name: '保存' }).click();
    const saved = JSON.parse((await page.evaluate(() => localStorage.getItem('adc:local:v1')))!);
    expect(saved.tasks[0].links).toEqual({});
    await expect(page.getByTestId('gh-links')).toContainText('Issue: 紐付けなし');

    await page.getByTestId('task-card').getByRole('button', { name: '編集' }).click();
    const edit = page.getByRole('dialog');
    await expect(edit.getByLabel('Issue番号（手動紐付け）')).toHaveAttribute('placeholder', '例：1');
    await expect(edit).toContainText('任意。未入力ならPRとは紐付けされません。');
    await edit.getByLabel('Issue番号（手動紐付け）').fill('7');
    await edit.getByRole('button', { name: '保存' }).click();
    await expect(page.getByTestId('gh-links')).toContainText('Issue #7');
    await page.getByTestId('task-card').getByRole('button', { name: '編集' }).click();
    await expect(page.getByRole('dialog').getByLabel('Issue番号（手動紐付け）')).toHaveValue('7');
  });

  test('the sync page explains the possible 60 s cache', async ({ page }) => {
    await page.goto('/');
    await addProject(page, 'Lab', 'o/a');
    await nav(page, 'GitHub連携');
    await expect(page.getByText('最大60秒キャッシュされることがある')).toBeVisible();
  });
});
