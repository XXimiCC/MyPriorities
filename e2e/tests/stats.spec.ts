/*
 * Экран статистики говорит и тогда, когда сказать ещё нечего.
 *
 * Три сюжета здесь про пустоту: блок наблюдений до первого набранного порога,
 * строка про единственный экземпляр истории и окно, в котором экран
 * открывается у вернувшегося после паузы. Проверяются браузером, а не тестом
 * логики, потому что все три — про то, что человек видит на экране, и зависят
 * от условий, которых логика не знает: включённого модуля, режима демо,
 * состояния входа.
 */

import { expect, onboard, openApp, tab, test } from '../fixtures';

/**
 * Копия данных с заданной историей отметок.
 *
 * Восстановление — единственный путь дать чистому кабинету прошлое: демо для
 * этого не годится, там запись подменена памятью и строка про устройство
 * намеренно молчит.
 */
function backupWith(clicks: Record<string, Record<string, number>>): string {
  return JSON.stringify({
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
    journal: { clicks, battery: {} },
    skillClicks: {},
    awards: {},
  });
}

/*
 * История заведомо старше порога строки про устройство: 15 января — 198-й день
 * до зафиксированного «сегодня» (см. FIXED_TIME), то есть ровно шесть полных
 * месяцев после округления вниз. Вторая отметка — свежая, 30 июля.
 */
const BACKUP = backupWith({ '2026-01-15': { ab: 4 }, '2026-07-30': { ab: 2 } });

/** Восстановить копию из настроек. Диалоги подтверждения принимаются. */
async function restoreBackup(
  page: import('@playwright/test').Page,
  json: string = BACKUP,
): Promise<void> {
  page.on('dialog', (dialog) => void dialog.accept());
  await tab(page, 'Settings').click();
  await page.locator('.sset__file input[type=file]').setInputFiles({
    name: 'my-priorities-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(json, 'utf8'),
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

/*
 * Вернувшийся после паузы.
 *
 * Проверяется браузером, а не тестом логики, по той же причине, что и всё
 * выше: правило живёт в домене (initialPeriod), но смысл у него один — что
 * человек увидит, открыв экран. Ошибиться можно и не в правиле, а в проводке.
 *
 * 24 июля — восьмой день до зафиксированного «сегодня»: ровно за краем окна
 * «7 дней», которое считается от 25 июля.
 */
test.describe('вернувшийся после паузы', () => {
  const selected = (page: import('@playwright/test').Page) =>
    page.locator('.pswitch [role=tab][aria-selected=true]');

  test('на чистом кабинете открываются «7 дней»: показывать нечего ни в каком окне', async ({
    page,
  }) => {
    await openApp(page);
    await onboard(page);
    await tab(page, 'Stats').click();

    await expect(selected(page)).toHaveText('7 days');
  });

  test('с отметками на этой неделе открываются «7 дней»', async ({ page }) => {
    await openApp(page);
    await onboard(page);
    // 30 июля — внутри окна: у копии по умолчанию отметка как раз там.
    await restoreBackup(page);

    await tab(page, 'Stats').click();
    await expect(selected(page)).toHaveText('7 days');
  });

  test('после недельной паузы открывается «всё время», и история видна', async ({ page }) => {
    await openApp(page);
    await onboard(page);
    await restoreBackup(page, backupWith({ '2026-07-24': { ab: 9 } }));

    await tab(page, 'Stats').click();
    await expect(selected(page)).toHaveText('All time');

    // Главное: экран больше не выглядит свежей установкой.
    await expect(page.locator('.empty', { hasText: 'Nothing marked' })).toHaveCount(0);
    await expect(page.locator('.tiles .tile__value').first()).toHaveText(/^4\.5\s?h$/);
    await expect(page.locator('.sbars .sbar__title').first()).toHaveText('Work');
  });

  test('переключил сам — эвристика молчит', async ({ page }) => {
    await openApp(page);
    await onboard(page);
    await restoreBackup(page, backupWith({ '2026-07-24': { ab: 9 } }));

    await tab(page, 'Stats').click();
    await page.locator('.pswitch').getByRole('tab', { name: '7 days' }).click();

    // Пустое окно, выбранное руками, — это ответ на вопрос человека, а не сбой.
    await expect(selected(page)).toHaveText('7 days');
    await expect(page.locator('.empty', { hasText: 'Nothing marked' })).toBeVisible();
  });
});
