/*
 * Времена отметок в шторке приоритета.
 *
 * Проверяется то, ради чего они заводились: «в 14:10 я это отмечал или мне
 * кажется?» — и промах по «+», который исправляется, не открывая ничего
 * другого. Прогон идёт браузером, потому что вопрос здесь не «сходится ли
 * проекция», а «видно ли это человеку в шторке».
 */

import { advanceMinutes, expect, onboard, openApp, test } from '../fixtures';

/** Часы прогона стоят на 14:20 — см. FIXED_TIME в fixtures.ts. */
const FIRST = '14:20';
const SECOND = '15:55';

/** Первая строка списка: отмечаем и открываем её же. */
function firstRow(page: import('@playwright/test').Page) {
  return page.locator('.home__list .prow').first();
}

test('шторка показывает время каждой отметки за сегодня', async ({ page }) => {
  await openApp(page);
  await onboard(page);

  await firstRow(page).locator('.prow__add').click();
  await advanceMinutes(page, 95);
  await firstRow(page).locator('.prow__add').click();

  await firstRow(page).locator('.prow__main').click();
  const sheet = page.getByRole('dialog');

  // Подпись называет вещи своими именами: это время отметки, а не время занятия.
  await expect(sheet.locator('.tune__marksLabel')).toHaveText('Marked today at');
  await expect(sheet.locator('.tune__mark')).toHaveText([FIRST, SECOND]);

  /*
   * «−» снимает именно последнюю отметку. Это и есть весь смысл стека: пока
   * блоки одинаковы, разницы не видно, а с временами промах виден и исправляется.
   */
  await sheet.getByRole('button', { name: 'Remove 30 minutes' }).click();
  await expect(sheet.locator('.tune__mark')).toHaveText([FIRST]);

  // Времена переживают перезагрузку — они лежат в журнале, а не в памяти экрана.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tabbar').waitFor();
  await firstRow(page).locator('.prow__main').click();
  await expect(page.getByRole('dialog').locator('.tune__mark')).toHaveText([FIRST]);
});

test('у записи в прошедший день времени нет', async ({ page }) => {
  await openApp(page);
  await onboard(page);

  await page.getByRole('button', { name: 'Fill in an earlier day' }).click();
  // Лента предлагает только прошедшие дни; сегодняшний в ней первый справа.
  await page.locator('.dpick__day').first().click();
  await expect(page.locator('.dpast')).toBeVisible();

  await firstRow(page).locator('.prow__add').click();
  await firstRow(page).locator('.prow__main').click();

  const sheet = page.getByRole('dialog');
  await expect(sheet.locator('.tune__time')).toHaveText('30m');
  // Ни строки, ни «неизвестно»: времени у такой отметки нет и выдумывать нечем.
  await expect(sheet.locator('.tune__marks')).toHaveCount(0);
});
