/*
 * Даты, у которых прошлое не ограничено этим годом.
 *
 * Ленты на четырнадцать и тридцать дней год не называют, и правильно: там его
 * неоткуда взять неверно. А вот дата открытия достижения и начало истории
 * уходят на годы назад — и без года «31 августа» у человека со стажем читается
 * как дата ЭТОГО года, иногда как ещё не наступившая.
 *
 * Профиль `max` для этого и взят: у него 397 дней истории и достижения,
 * полученные до семисот дней назад. Часы прогона стоят (см. fixtures.ts),
 * поэтому «сегодня» здесь — величина известная.
 */

import { enFormats } from '../../src/i18n/en';
import { expect, FIXED_TIME, openApp, tab, test } from '../fixtures';

/** Год и день прогона в поясе конфига (Europe/Moscow, см. playwright.config.ts). */
const THIS_YEAR = 2026;
const TODAY = new Date(2026, 6, 31);

/**
 * Подпись даты обратно в дату — так, как её читает человек: подпись без года
 * читается как дата текущего года. Именно это чтение и ломалось.
 */
function readLabel(text: string): Date | null {
  const parsed = /^([A-Za-z]{3}) (\d{1,2})(?:, (\d{4}))?$/.exec(text.trim());
  if (!parsed) return null;
  const month = enFormats.months.indexOf(parsed[1]!);
  if (month < 0) return null;
  return new Date(Number(parsed[3] ?? THIS_YEAR), month, Number(parsed[2]));
}

test('начало истории названо вместе с годом', async ({ page }) => {
  await openApp(page, { demo: 'max' });
  await tab(page, 'Settings').click();

  const since = page.locator('.sset__facts li').filter({ hasText: 'History since' }).locator('b');
  // У профиля 397 дней истории при часах, стоящих на 31 июля 2026: это 2025 год.
  await expect(since).toHaveText(/, 2025$/);
});

test('ни одна дата достижения не читается как ещё не наступившая', async ({ page }) => {
  await openApp(page, { demo: 'max' });
  await tab(page, 'Settings').click();
  await page.getByRole('button', { name: /^Achievements/ }).click();

  const labels = await page.locator('.ach__card small').allTextContents();
  expect(labels.length).toBeGreaterThan(20);

  const dated = labels.map((text) => ({ text, day: readLabel(text) })).filter((item) => item.day);
  // Иначе проверка ниже была бы пустой: на экране одни «Not unlocked yet».
  expect(dated.length).toBeGreaterThan(10);

  /*
   * Главное: дата, полученная год назад, не должна читаться как дата этого
   * года. С коротким форматом «Aug 31» и «Nov 9» уезжали в будущее — то есть
   * экран, чья работа отвечать «когда я это получил», отвечал неправдой.
   */
  const future = dated.filter((item) => item.day! > TODAY).map((item) => item.text);
  expect(future, 'даты из будущего на экране достижений').toEqual([]);

  // И год действительно называется там, где он нужен, а не убран отовсюду.
  const withYear = dated.filter((item) => /, \d{4}$/.test(item.text));
  expect(withYear.length).toBeGreaterThan(0);
});

test('в шторке достижения дата та же, что на карточке', async ({ page }) => {
  await openApp(page, { demo: 'max' });
  await tab(page, 'Settings').click();
  await page.getByRole('button', { name: /^Achievements/ }).click();

  const card = page.locator('.ach__card--on').first();
  const onCard = ((await card.locator('small').textContent()) ?? '').trim();
  expect(readLabel(onCard)).not.toBeNull();

  await card.click();
  // Шторка — второе место, где та же дата видна, и формат в них разъезжался.
  await expect(page.getByRole('dialog').locator('.achs__meta')).toHaveText(`Unlocked ${onCard}`);
});

test('свежая дата года не называет: он и так этот', async ({ page }) => {
  await openApp(page, { demo: 'max' });
  await tab(page, 'Settings').click();
  await page.getByRole('button', { name: /^Achievements/ }).click();

  const labels = await page.locator('.ach__card small').allTextContents();
  const thisYear = labels.filter((text) => {
    const day = readLabel(text);
    return day && day.getFullYear() === THIS_YEAR;
  });

  expect(thisYear.length).toBeGreaterThan(0);
  // Год этого года — это шум: подпись обязана остаться короткой.
  for (const text of thisYear) expect(text, text).not.toMatch(/\d{4}/);
});

test('дату на ленте дней год не удлиняет', async ({ page }) => {
  await openApp(page, { demo: 'max' });
  await tab(page, 'Stats').click();

  /*
   * Полоса по дням подписывает края периода — но только когда столбцов больше
   * четырнадцати, поэтому берём тридцать дней. Это окно всегда внутри года
   * относительно «сейчас»: год там был бы лишним, и короткий формат остаётся.
   */
  await page.locator('.pswitch').getByRole('tab', { name: '30 days' }).click();

  const edges = await page.locator('.dstrip__axis span').allTextContents();
  // Полос две — по дням и по энергии, — и края у них общие.
  expect(edges.length).toBeGreaterThanOrEqual(2);
  for (const text of edges) {
    expect(text, text).not.toMatch(/\d{4}/);
    expect(readLabel(text), text).not.toBeNull();
  }
});
