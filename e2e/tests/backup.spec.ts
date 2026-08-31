/*
 * Резервная копия: выгрузка и возврат.
 *
 * Это единственный путь, которым данные вообще покидают устройство: аккаунта
 * нет, сети может не быть, а «Стереть всё» необратимо. Значит проверять надо
 * не кнопку, а круг целиком — выгрузили, изменили данные, вернули копию, и на
 * экране снова то, что было в момент выгрузки.
 *
 * Системные вопросы здесь настоящие: вне Telegram confirmDialog и alertDialog
 * — это window.confirm и window.alert, а Playwright по умолчанию их отклоняет.
 * Отсюда acceptDialogs: без него импорт молча не состоялся бы.
 */

import fs from 'node:fs/promises';

import { acceptDialogs, expect, onboard, openApp, tab, test } from '../fixtures';

const FIRST = '.home__list .prow';

test('копия выгружается файлом, и в ней лежат настоящие данные', async ({ page }) => {
  await openApp(page);
  await onboard(page);

  const row = page.locator(FIRST).first();
  const title = (await row.locator('.prow__title').textContent()) ?? '';
  await row.getByRole('button', { name: 'Add 30 minutes: ' + title }).click();
  await expect(row.locator('.prow__value')).toHaveText('30m');

  await tab(page, 'Settings').click();

  // Скачивание ловится событием, а не ожиданием файла на диске: путь до него
  // Playwright отдаёт сам, когда браузер закончил.
  const started = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download a backup' }).click();
  const download = await started;

  expect(download.suggestedFilename()).toBe('my-priorities-backup.json');

  const path = await download.path();
  const snapshot = JSON.parse(await fs.readFile(path, 'utf8')) as {
    app: string;
    version: number;
    settings: { priorities: Array<{ title: string }> };
    journal: { clicks: Record<string, Record<string, number>> };
  };

  expect(snapshot.app).toBe('my-priorities');
  expect(snapshot.version).toBe(2);
  // Список человека, а не пустая заготовка.
  expect(snapshot.settings.priorities.map((p) => p.title)).toContain(title);
  // И его отметка: ровно один день, ровно один блок.
  const days = Object.values(snapshot.journal.clicks);
  expect(days).toHaveLength(1);
  expect(Object.values(days[0]!)).toEqual([1]);
});

test('копия возвращает данные обратно и остаётся после перезагрузки', async ({ page }) => {
  const asked = acceptDialogs(page);

  await openApp(page);
  await onboard(page);

  const row = page.locator(FIRST).first();
  const value = row.locator('.prow__value');
  const title = (await row.locator('.prow__title').textContent()) ?? '';
  const add = row.getByRole('button', { name: 'Add 30 minutes: ' + title });

  await add.click();
  await add.click();
  await expect(value).toHaveText('1h');

  await tab(page, 'Settings').click();
  const started = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download a backup' }).click();
  const path = await (await started).path();

  // Данные уезжают вперёд: без этого возврат копии был бы неотличим от бездействия.
  await tab(page, 'Priorities').click();
  await add.click();
  await expect(value).toHaveText('1.5h');

  await tab(page, 'Settings').click();
  // Поле файла спрятано под кнопкой-подписью, поэтому setInputFiles, а не клик.
  await page.locator('.sset__file input[type=file]').setInputFiles(path);

  /*
   * Отчёт об импорте — единственное место, где приложение говорит, ЧТО именно
   * приехало. Сначала подтверждение замены, потом итог.
   */
  await expect
    .poll(() => asked.length, { message: 'спросили и отчитались' })
    .toBeGreaterThanOrEqual(2);
  expect(asked[0]).toContain('Restore your data from a backup?');
  expect(asked[1]).toMatch(/^Done: \d+ priorit(y|ies), 1 day of history\.$/);

  await tab(page, 'Priorities').click();
  await expect(value).toHaveText('1h');
  await expect(row.locator('.prow__title')).toHaveText(title);

  // Возврат — это запись на устройство, а не состояние экрана.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tabbar').waitFor();
  await expect(page.locator(FIRST).first().locator('.prow__value')).toHaveText('1h');
});

test('битый файл отвергается с объяснением, а данные остаются целы', async ({ page }, testInfo) => {
  const asked = acceptDialogs(page);

  await openApp(page);
  await onboard(page);

  const row = page.locator(FIRST).first();
  const title = (await row.locator('.prow__title').textContent()) ?? '';
  await row.getByRole('button', { name: 'Add 30 minutes: ' + title }).click();
  await expect(row.locator('.prow__value')).toHaveText('30m');

  const broken = testInfo.outputPath('broken.json');
  await fs.writeFile(broken, '{"app":"my-priorities","version":2', 'utf8');

  await tab(page, 'Settings').click();
  await page.locator('.sset__file input[type=file]').setInputFiles(broken);

  await expect.poll(() => asked.length).toBeGreaterThanOrEqual(2);
  // Не «ничего не произошло»: человек обязан узнать, что копия не подошла.
  expect(asked[1]).toContain('file');

  await tab(page, 'Priorities').click();
  await expect(page.locator(FIRST).first().locator('.prow__value')).toHaveText('30m');
});
