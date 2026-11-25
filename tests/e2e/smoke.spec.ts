import { test, expect } from '@playwright/test';

test('app shell renders in Japanese with the dashboard and no sample data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
  await expect(page.getByTestId('stat-projects')).toHaveText('0');
  await expect(page.getByText('サンプルデータはありません')).toBeVisible();
});
