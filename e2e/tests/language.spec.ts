/*
 * Два языка.
 *
 * Проверяются две разные вещи, которые легко спутать. Первая: кнопка в
 * настройках действительно меняет интерфейс и запоминает выбор. Вторая: ни на
 * одном экране не остаётся ключа вместо строки — t() возвращает сам ключ, если
 * перевода нет, и на экране это выглядит как «home.holdHint».
 *
 * Словари берутся настоящие: en.ts и ru.ts не импортируют ничего (это стережёт
 * tools/deps.test.ts), поэтому их можно прочитать отсюда и сверяться со всем
 * реестром ключей, а не с догадкой о том, как ключ выглядит.
 */

import { enStrings } from '../../src/i18n/en';
import { ruStrings } from '../../src/i18n/ru';
import { expect, onboard, openApp, tab, test } from '../fixtures';

const KEYS = new Set([...Object.keys(ruStrings), ...Object.keys(enStrings)]);

const TABS = {
  en: ['Priorities', 'Charge', 'Skills', 'Stats', 'Settings'],
  ru: ['Приоритеты', 'Заряд', 'Навыки', 'Статистика', 'Настройки'],
} as const;

/**
 * Всё видимое на экране — по кускам, пригодным для сверки с реестром.
 *
 * Берётся innerText каждого листового узла: целиком у `.app` он склеился бы в
 * одну строку, в которой ключ не отличить от текста.
 *
 * Размытая витрина пустого экрана навыков исключена намеренно: она помечена
 * aria-hidden и нечитаема по построению (см. src/skills/SkillsEmpty.css), а
 * названия примеров там записаны литералами мимо словаря.
 */
async function visibleTexts(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const node of document.querySelectorAll('.app *')) {
      if (node.children.length > 0) continue;
      if (node.closest('[aria-hidden="true"]')) continue;
      const text = (node as HTMLElement).innerText?.trim();
      if (text) out.push(text);
    }
    return out;
  });
}

/** Ключ, доехавший до экрана вместо строки, и незакрытая подстановка {имя}. */
function leftovers(texts: string[]): string[] {
  return texts.filter((text) => KEYS.has(text) || /\{\w+\}/.test(text));
}

for (const [code, tabs] of Object.entries(TABS)) {
  test(`ни один экран не показывает ключ вместо строки (${code})`, async ({ page }) => {
    await openApp(page, { demo: 'max', lang: code });
    await expect(page.locator('html')).toHaveAttribute('lang', code);

    for (const name of tabs) {
      await tab(page, name).click();
      await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
      expect(leftovers(await visibleTexts(page)), `вкладка «${name}»`).toEqual([]);
    }
  });
}

test('кнопка языка меняет интерфейс и запоминает выбор', async ({ page }) => {
  /*
   * Свои данные, а не демо: в демо выбор языка НЕ запоминается намеренно (см.
   * следующий тест), и проверка «переживает перезагрузку» там доказывала бы
   * обратное тому, что приложение обещает.
   */
  await openApp(page);
  await onboard(page);
  await tab(page, 'Settings').click();

  const tabbar = page.locator('.tabbar');
  await expect(tabbar).toContainText('Priorities');
  await expect(page.locator('.sset__block--on').first()).toHaveText('English');

  await page.locator('.sset__lang').getByRole('button', { name: 'Русский' }).click();

  // Меняется всё дерево разом: вкладки, заголовок экрана и атрибут языка.
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(tabbar).toContainText('Приоритеты');
  await expect(tabbar).not.toContainText('Priorities');
  await expect(page.locator('.header__title').first()).toHaveText('Настройки');
  await expect(page.locator('.sset__block--on').first()).toHaveText('Русский');

  // Человек остаётся там, где нажал, а не уезжает на первую вкладку.
  await expect(page.locator('.tabbar').getByRole('tab', { name: 'Настройки', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  /*
   * `?lang=` снимается с адреса: он стоит выше сохранённого выбора, и оставить
   * его значило бы отменять нажатую кнопку на каждой перезагрузке.
   */
  expect(new URL(page.url()).searchParams.has('lang')).toBe(false);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tabbar').waitFor();
  await expect(page.locator('.tabbar')).toContainText('Приоритеты');

  // И обратно: выбор не в один конец.
  await tab(page, 'Настройки').click();
  await page.locator('.sset__lang').getByRole('button', { name: 'English' }).click();
  await expect(page.locator('.tabbar')).toContainText('Priorities');
});

test('язык, выбранный гостем в демо, не остаётся у владельца', async ({ page }) => {
  /*
   * Демо не оставляет следов на устройстве. Язык — единственное, что проходит
   * мимо подменённого хранилища (он нужен до первой отрисовки), поэтому у него
   * свой заслон: src/platform/language.ts, ставится из main.tsx.
   *
   * `lang: ''` снимает параметр с адреса: с прибитым языком тест не увидел бы
   * ничего, потому что параметр стоит выше сохранённого выбора.
   */
  await openApp(page, { lang: '' });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible();

  await openApp(page, { demo: 'max' });
  await tab(page, 'Settings').click();
  await page.locator('.sset__lang').getByRole('button', { name: 'Русский' }).click();
  // Внутри сеанса переключение работает как обычно: гостю показывают приложение
  // на его языке — гасится только запись на устройство.
  await expect(page.locator('.tabbar')).toContainText('Приоритеты');

  await openApp(page, { lang: '' });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible();
});
