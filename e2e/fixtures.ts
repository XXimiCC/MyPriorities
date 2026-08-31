/*
 * Общая обвязка сквозных проверок.
 *
 * Три вещи, которые иначе пришлось бы повторять в каждом файле: молчащая
 * консоль, открытие приложения до готовности и первый запуск.
 */

import { test as base, expect, type Page } from '@playwright/test';

/**
 * Момент времени, одинаковый во всех прогонах.
 *
 * Пятница, середина дня — как при съёмке документации (tools/shots/capture.mjs),
 * и по тем же причинам: в тридцатидневном окне есть и будни, и выходные, а до
 * полуночи далеко. Последнее здесь важнее всего: без фиксации прогон, начатый в
 * 23:59, увидел бы смену суток посреди теста.
 *
 * Демо-история и лестница навыков разворачиваются от «сегодня», поэтому с любой
 * датой набор данных остаётся тем же — меняются только подписи дней.
 */
export const FIXED_TIME = new Date('2026-07-31T14:20:00+03:00');

/**
 * Перевести часы страницы вперёд.
 *
 * Нужно там, где проверяется длительность: приложение считает заряд между
 * отметками, и на стоящих часах только что поставленная отметка честно длится
 * ноль минут. Экраны берут «сейчас» при отрисовке, поэтому достаточно
 * передвинуть часы и вернуться на экран.
 */
export async function advanceMinutes(page: Page, minutes: number): Promise<void> {
  await page.clock.setFixedTime(new Date(FIXED_TIME.getTime() + minutes * 60_000));
}

/** Единственный надёжный признак готовности: класс снимается после ready в сторе. */
export const READY = '.app:not(.app--loading)';

interface Fixtures {
  /** Ошибки и предупреждения консоли, накопленные за тест. */
  consoleErrors: string[];
}

export const test = base.extend<Fixtures>({
  /*
   * Ошибка в консоли при зелёном тесте — всё равно дефект, поэтому проверка
   * общая, а не написана в одном тесте про демо. Предупреждения тоже: сегодня их
   * нет ни на одном экране, и первое появившееся стоит увидеть сразу.
   */
  consoleErrors: [
    async ({ page }, use) => {
      const found: string[] = [];
      page.on('console', (message) => {
        const type = message.type();
        if (type === 'error' || type === 'warning') found.push(`[${type}] ${message.text()}`);
      });
      page.on('pageerror', (error) => found.push(`[pageerror] ${error.message}`));
      await use(found);
      expect(found, 'консоль браузера должна молчать').toEqual([]);
    },
    { auto: true },
  ],

  page: async ({ page }, use) => {
    /*
     * Настоящий SDK Telegram не нужен ни в одном прогоне, а сходить за ним
     * index.html пытается всегда. Без заглушки набор зависел бы от сети.
     */
    await page.route('**/telegram-web-app.js', (route) => route.fulfill({ body: '' }));
    await page.clock.setFixedTime(FIXED_TIME);
    await use(page);
  },
});

export { expect };

/**
 * Открыть приложение и дождаться, пока стор поднимется.
 *
 * `devkit=0` гасит панель отладки: на локальном адресе она считает машину своей
 * и показывает кнопку поверх интерфейса (src/devkit/access.ts) — то есть ровно
 * там, где идёт прогон.
 *
 * Язык прибит параметром, а не оставлен контексту: приложение выбирает его из
 * четырёх источников (src/i18n/index.ts), и совпадение с локалью контекста было
 * бы везением, а не договором.
 */
export async function openApp(page: Page, params: Record<string, string> = {}): Promise<void> {
  const query = new URLSearchParams({ devkit: '0', lang: 'en', ...params });
  /*
   * Пустое значение снимает параметр вовсе. Нужно ровно одному тесту — тому,
   * что проверяет, каким язык окажется САМ: с прибитым `?lang=` сохранённый
   * выбор не виден, потому что параметр стоит выше него (src/i18n/index.ts).
   */
  for (const [key, value] of [...query]) if (value === '') query.delete(key);
  await page.goto(`/?${query.toString()}`, { waitUntil: 'domcontentloaded' });
  await page.locator(READY).waitFor();
}

/**
 * Отвечать «да» на системные вопросы и закрывать сообщения.
 *
 * Вне Telegram confirmDialog и alertDialog — это window.confirm и window.alert
 * (src/telegram/sdk.ts), а Playwright по умолчанию их ОТКЛОНЯЕТ. Без этого
 * обработчика «Импортировать?» молча получает «нет», и тест проверяет
 * несостоявшееся действие, ничего при этом не замечая.
 *
 * Возвращается список заданных вопросов: сообщение об итоге импорта — это
 * единственное место, где приложение отчитывается о том, что именно приехало.
 */
export function acceptDialogs(page: Page): string[] {
  const asked: string[] = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
  return asked;
}

/**
 * Пройти первый запуск: три слайда пропускаются, берётся первый готовый набор.
 *
 * Нужен всем записывающим тестам: в обычном режиме пустое хранилище означает
 * онбординг, а без списка приоритетов отмечать нечего.
 */
export async function onboard(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.locator('.pcard').first().click();
  await page.getByRole('button', { name: 'Use this set' }).click();
  await page.locator('.tabbar').waitFor();
}

/**
 * Перейти на вкладку по подписи. Локатор сужен до панели вкладок: переключатель
 * периода на главной и в статистике — тоже role="tab".
 */
export function tab(page: Page, label: string) {
  return page.locator('.tabbar').getByRole('tab', { name: label, exact: true });
}
