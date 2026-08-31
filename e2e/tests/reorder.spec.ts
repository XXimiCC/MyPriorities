/*
 * Перестановка приоритетов перетаскиванием.
 *
 * Собственная реализация на Pointer Events без библиотеки (src/components/
 * useReorder.ts), и держится она на арифметике: смещение курсора делится на
 * высоту первой строки, и получается новый индекс. Ошибка на единицу здесь
 * ничего не роняет — она просто ставит строку не туда, и заметить это можно
 * только глазами. Отсюда сквозная проверка.
 *
 * Порядок — не украшение: первым в списке стоит то, на что чаще всего жмут,
 * и он же задаёт порядок на главном экране.
 */

import { expect, onboard, openApp, tab, test } from '../fixtures';
import type { Locator, Page } from '@playwright/test';

const HOME_ROWS = '.home__list .prow__title';
const EDIT_ROWS = '.edit__list .erow';

/** Названия строк — тем же способом на обоих экранах: в разметке они как есть. */
function titles(rows: Locator): Promise<string[]> {
  return rows.allTextContents();
}

/**
 * Открыть экран правки: долгое удержание на строке приоритета.
 *
 * Второго входа нет — так задумано (см. home.holdHint). Кнопка не отпускается
 * до появления экрана: onPointerUp гасит таймер удержания, и отпущенная раньше
 * времени строка просто откроет счётчик. Ожидание — на появлении экрана, а не
 * на времени: спать здесь было бы гаданием о том, сколько длится HOLD_MS.
 */
async function openEditor(page: Page): Promise<void> {
  const row = page.locator('.home__list .prow__main').first();
  await row.hover();
  await page.mouse.down();
  await expect(page.locator('.edit__list')).toBeVisible();
  await page.mouse.up();
}

test('строку можно перетащить, и новый порядок доезжает до главной', async ({ page }) => {
  await openApp(page);
  await onboard(page);

  const before = await titles(page.locator(HOME_ROWS));
  expect(before.length).toBeGreaterThan(2);

  await openEditor(page);
  const rows = page.locator(EDIT_ROWS);
  await expect(rows.locator('.erow__title')).toHaveText(before);

  /*
   * Тащим первую строку на место третьей. Расстояние берётся у самих строк, а
   * не константой: высота зависит от шрифта и вёрстки, а индекс в useReorder
   * считается делением смещения ровно на неё.
   */
  const first = rows.nth(0).locator('.erow__handle');
  const third = rows.nth(2);
  const from = (await first.boundingBox())!;
  const to = (await third.boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Два шага, а не один: pointermove с нулевым промежуточным положением
  // выглядит как рывок и не похож на палец.
  await page.mouse.move(from.x + from.width / 2, from.y + (to.y - from.y) / 2);
  await page.mouse.move(from.x + from.width / 2, to.y + to.height / 2);
  await page.mouse.up();

  const expected = [before[1]!, before[2]!, before[0]!, ...before.slice(3)];
  await expect(rows.locator('.erow__title')).toHaveText(expected);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator(HOME_ROWS)).toHaveText(expected);

  // Порядок — это запись, а не состояние экрана.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tabbar').waitFor();
  await expect(page.locator(HOME_ROWS)).toHaveText(expected);
});

test('стрелки двигают строку на одну позицию и упираются в края', async ({ page }) => {
  await openApp(page);
  await onboard(page);

  const before = await titles(page.locator(HOME_ROWS));
  await openEditor(page);
  const rows = page.locator(EDIT_ROWS);

  // У первой строки «вверх» выключена, у последней — «вниз»: списку некуда деться.
  await expect(rows.first().getByRole('button', { name: 'Move up' })).toBeDisabled();
  await expect(rows.last().getByRole('button', { name: 'Move down' })).toBeDisabled();

  await rows.nth(1).getByRole('button', { name: 'Move up' }).click();

  const swapped = [before[1]!, before[0]!, ...before.slice(2)];
  await expect(rows.locator('.erow__title')).toHaveText(swapped);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator(HOME_ROWS)).toHaveText(swapped);
});

test('перетаскивание, не сдвинувшее строку, ничего не меняет', async ({ page }) => {
  await openApp(page);
  await onboard(page);

  const before = await titles(page.locator(HOME_ROWS));
  await openEditor(page);
  const rows = page.locator(EDIT_ROWS);

  /*
   * Смещение меньше половины строки округляется в тот же индекс. Проверяется
   * потому, что промах пальцем на несколько пикселей — самое частое движение
   * во всём экране, и переставлять список от него нельзя.
   */
  const handle = rows.nth(1).locator('.erow__handle');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 6);
  await page.mouse.up();

  await expect(rows.locator('.erow__title')).toHaveText(before);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator(HOME_ROWS)).toHaveText(before);
});
