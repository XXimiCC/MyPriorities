/*
 * Экран статистики говорит и тогда, когда сказать ещё нечего.
 *
 * Оба сюжета здесь про пустоту, которую видит новичок: блок наблюдений до
 * первого набранного порога и строку про единственный экземпляр истории.
 * Проверяются браузером, а не тестом логики, потому что оба — про то, что
 * человек видит на экране, и оба зависят от условий, которые логика не знает:
 * включённого модуля, режима демо и состояния входа.
 */

import { expect, onboard, openApp, tab, test } from '../fixtures';

/**
 * Копия данных с историей заведомо старше порога.
 *
 * Восстановление — единственный путь получить полгода истории на чистом
 * кабинете: демо для этого не годится, там запись подменена памятью и строка
 * про устройство намеренно молчит.
 *
 * 15 января — 198-й день до зафиксированного «сегодня» (см. FIXED_TIME), то
 * есть ровно шесть полных месяцев после округления вниз.
 */
const BACKUP = JSON.stringify({
  app: 'my-priorities',
  version: 2,
  exportedAt: '2026-07-31T09:00:00.000Z',
  settings: {
    version: 1,
    priorities: [{ id: 'ab', title: 'Work', colorId: 0 }],
    archived: [],
    onboarded: true,
    blockMinutes: 30,
    modules: { skills: true, achievements: true, insights: true },
  },
  journal: {
    clicks: { '2026-01-15': { ab: 4 }, '2026-07-30': { ab: 2 } },
    battery: {},
  },
  skillClicks: {},
  awards: {},
});

/** Восстановить эту копию из настроек. Диалоги подтверждения принимаются. */
async function restoreBackup(page: import('@playwright/test').Page): Promise<void> {
  page.on('dialog', (dialog) => void dialog.accept());
  await tab(page, 'Settings').click();
  await page.locator('.sset__file input[type=file]').setInputFiles({
    name: 'my-priorities-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(BACKUP, 'utf8'),
  });
  // Признак того, что копия доехала: приоритет из файла встал на главной.
  await tab(page, 'Priorities').click();
  await expect(page.locator('.home__list .prow__title').first()).toHaveText('Work');
}

test.describe('наблюдения до порога', () => {
  test('на чистом кабинете стоит заголовок и строка о том, чего ждать', async ({ page }) => {
    await openApp(page);
    await onboard(page);
    await tab(page, 'Stats').click();

    await expect(page.locator('.divider-label', { hasText: 'Observations' })).toBeVisible();
    await expect(page.locator('.ins p.ins__item')).toHaveText(/about a week of marks/);
  });

  test('ссылка под заглушкой ведёт в готовые истории', async ({ page }) => {
    await openApp(page);
    await onboard(page);
    await tab(page, 'Stats').click();

    await page.locator('.ins__demo').click();
    await expect(page.locator('.header__title').first()).toHaveText('Show a friend');
    await expect(page.locator('.dcard').first()).toBeVisible();
  });

  test('первое настоящее наблюдение убирает заглушку', async ({ page }) => {
    await openApp(page, { demo: 'max' });
    await tab(page, 'Stats').click();

    await expect(page.locator('.ins li.ins__item').first()).toBeVisible();
    await expect(page.locator('.ins p.ins__item')).toHaveCount(0);
  });

  test('выключенный модуль убирает блок целиком', async ({ page }) => {
    await openApp(page);
    await onboard(page);

    await tab(page, 'Settings').click();
    await page.getByRole('switch', { name: 'Observations' }).click();

    await tab(page, 'Stats').click();
    await expect(page.locator('.divider-label', { hasText: 'Observations' })).toHaveCount(0);
    await expect(page.locator('.ins')).toHaveCount(0);
  });
});

test.describe('только это устройство', () => {
  test('на чистом кабинете строки нет: терять ещё нечего', async ({ page }) => {
    await openApp(page);
    await onboard(page);
    await tab(page, 'Stats').click();

    await expect(page.locator('.lonly')).toHaveCount(0);
  });

  test('с историей старше порога строка называет её срок и предлагает копию', async ({ page }) => {
    await openApp(page);
    await onboard(page);
    await restoreBackup(page);

    await tab(page, 'Stats').click();
    await expect(page.locator('.lonly__text')).toHaveText(
      '6 months of history exists only on this device.',
    );
    await expect(page.locator('.lonly__act', { hasText: 'Download a backup' })).toBeVisible();
  });

  test('закрытая строка не возвращается даже после перезапуска', async ({ page }) => {
    await openApp(page);
    await onboard(page);
    await restoreBackup(page);

    await tab(page, 'Stats').click();
    await page.locator('.lonly__act', { hasText: 'Close' }).click();
    await expect(page.locator('.lonly')).toHaveCount(0);

    await openApp(page);
    await tab(page, 'Stats').click();
    await expect(page.locator('.lonly')).toHaveCount(0);
  });

  test('в демо строки нет вовсе: история там не своя', async ({ page }) => {
    await openApp(page, { demo: 'max' });
    await tab(page, 'Stats').click();

    await expect(page.locator('.lonly')).toHaveCount(0);
  });
});
