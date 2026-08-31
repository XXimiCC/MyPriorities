/*
 * Офлайн и сервис-воркер.
 *
 * Обещание приложения — «работает без сети» — держится на двух разных вещах, и
 * обе проверяются здесь. Данные лежат в IndexedDB на устройстве, а САМО
 * приложение приезжает по сети, и без кэша (public/sw.js) второй заход без
 * связи показал бы «нет соединения» вместо экрана с данными.
 *
 * Воркер ставится не всегда: внутри Telegram, в демо и во фрейме его нет
 * намеренно (см. src/main.tsx). Проверяется поэтому обычный браузер на верхнем
 * уровне — единственное место, где он вообще должен появиться.
 *
 * Своё состояние у каждого теста: у контекста Playwright свои кэши и своя
 * регистрация воркера, так что прогоны не наследуют чужой кэш.
 */

import { expect, onboard, openApp, tab, test } from '../fixtures';
import type { Page } from '@playwright/test';

const FIRST = '.home__list .prow';

/**
 * Дождаться, пока воркер встанет и возьмёт страницу под себя.
 *
 * Два условия, а не одно. `ready` говорит, что воркер активен, но страницу,
 * загруженную до него, он ещё не контролирует — до `clients.claim()`. А
 * ассеты кладутся в кэш только тем запросом, который прошёл ЧЕРЕЗ воркера,
 * то есть начиная со следующей загрузки.
 */
async function serviceWorkerReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
      });
    }
  });
}

test('воркер встаёт в обычном браузере и берёт страницу под себя', async ({ page }) => {
  await openApp(page);
  await onboard(page);

  await serviceWorkerReady(page);

  const scope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.scope;
  });
  // Область — весь сайт: приложение открывают и с параметрами, и по «/».
  expect(new URL(scope).pathname).toBe('/');

  // Версия приезжает строкой запроса — на ней держится смена воркера при выкатке.
  const script = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.scriptURL ?? '';
  });
  expect(new URL(script).searchParams.get('v')).toBeTruthy();
});

test('в демо воркер не ставится: следов на устройстве не остаётся', async ({ page }) => {
  await openApp(page, { demo: 'max' });
  await expect(page.locator('.demobar')).toBeVisible();

  /*
   * Отсутствие проверяется тем, что регистрации нет ВООБЩЕ. Ждать «пока не
   * появится» бессмысленно, поэтому сначала дожидаемся полной загрузки
   * страницы: регистрация в обычном режиме идёт по событию load.
   */
  await page.waitForLoadState('load');
  const registrations = await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistrations()).length,
  );
  expect(registrations).toBe(0);
});

test('без сети приложение открывается и показывает записанное', async ({ page, context }) => {
  await openApp(page);
  await onboard(page);

  const row = page.locator(FIRST).first();
  const title = (await row.locator('.prow__title').textContent()) ?? '';
  await row.getByRole('button', { name: 'Add 30 minutes: ' + title }).click();
  await expect(row.locator('.prow__value')).toHaveText('30m');

  await serviceWorkerReady(page);

  /*
   * Заход по сети, но уже под воркером: только теперь запросы ассетов идут
   * через него и попадают в кэш. Воркер кладёт при установке ТОЛЬКО документ
   * (public/sw.js), поэтому без этого шага следующий заход без сети остался бы
   * без скриптов — и это не обход теста, а тот же путь, что у человека:
   * первый визит греет кэш, дальше приложение открывается всегда.
   */
  await openApp(page);
  await expect(page.locator(FIRST).first().locator('.prow__value')).toHaveText('30m');

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.app:not(.app--loading)').waitFor();

    // Не «страница открылась», а «приложение работает»: данные на месте.
    const offlineRow = page.locator(FIRST).first();
    await expect(offlineRow.locator('.prow__title')).toHaveText(title);
    await expect(offlineRow.locator('.prow__value')).toHaveText('30m');

    // И запись без сети тоже идёт: хранилище местное, сеть ему не нужна.
    await offlineRow.getByRole('button', { name: 'Add 30 minutes: ' + title }).click();
    await expect(offlineRow.locator('.prow__value')).toHaveText('1h');

    // Вкладки не подгружаются отдельно — экран статистики обязан открыться тоже.
    await tab(page, 'Stats').click();
    await expect(page.locator('.tile').first().locator('.tile__value')).toContainText('1');
  } finally {
    await context.setOffline(false);
  }
});

test('записанное без сети остаётся после возвращения связи', async ({ page, context }) => {
  await openApp(page);
  await onboard(page);
  await serviceWorkerReady(page);
  await openApp(page);

  const row = page.locator(FIRST).first();
  const title = (await row.locator('.prow__title').textContent()) ?? '';

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.app:not(.app--loading)').waitFor();
    const offlineRow = page.locator(FIRST).first();
    await offlineRow.getByRole('button', { name: 'Add 30 minutes: ' + title }).click();
    await expect(offlineRow.locator('.prow__value')).toHaveText('30m');
  } finally {
    await context.setOffline(false);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tabbar').waitFor();
  await expect(page.locator(FIRST).first().locator('.prow__value')).toHaveText('30m');
});
