import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';
import { Navigation } from './page-models/navigation';

// Exposed only by the test build; this declaration stays local to this module.
declare const window: Window & {
  $send: <T>(name: string, args?: unknown) => Promise<T>;
};

test('reviews annual evidence, persists dismissal, restores and creates a schedule', async ({
  browser,
}, testInfo) => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  try {
    await page.goto('/');
    await new ConfigurationPage(page).createTestFile();
    await page.evaluate(async () => {
      const send = window.$send;
      const account = await send<string>('account-create', {
        name: 'Discovery demo card',
        balance: 0,
      });
      const payee = await send<string>('payee-create', {
        name: 'Annual demo service',
      });
      await send('transactions-batch-update', {
        added: ['2025-01-10', '2026-01-10'].map(date => ({
          id: crypto.randomUUID(),
          account,
          payee,
          date,
          amount: -9900,
        })),
        runTransfers: false,
      });
    });
    const navigation = new Navigation(page);
    await navigation.goToSchedulesPage();
    await page.getByRole('button', { name: 'Find schedules' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByText('Annual demo service', { exact: true }),
    ).toBeVisible();
    const row = dialog
      .getByTestId('row')
      .filter({ hasText: 'Annual demo service' });
    await expect(row).toContainText('Based on 2 transactions');
    await expect(row).toContainText('Last observed');
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('recurring-review.png'),
    });
    await page.setViewportSize({ width: 760, height: 900 });
    await page.screenshot({
      path: testInfo.outputPath('recurring-review-narrow.png'),
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await row.click();
    await dialog.getByRole('button', { name: 'Dismiss selected' }).click();
    await expect(
      dialog.getByText('Annual demo service', { exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Find schedules' }).click();
    await expect(
      dialog.getByText('Annual demo service', { exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Restore dismissed' }).click();
    await expect(row).toBeVisible();
    await row.click();
    await dialog.getByRole('button', { name: 'Create schedules' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByText('Annual demo service', { exact: true }),
    ).toBeVisible();
  } finally {
    await page.close();
  }
});
