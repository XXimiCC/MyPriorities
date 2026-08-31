/*
 * Запись блока — обычный режим, не демо.
 *
 * Главное обещание приложения: отметка сделана на устройстве и остаётся на нём
 * без входа и без сети. Значит, перезагрузка страницы обязана её пережить.
 *
 * Хранилище чистое у каждого теста само собой: Playwright даёт каждому свой
 * контекст браузера, а с ним свои IndexedDB и localStorage.
 */

import { expect, onboard, openApp, tab, test } from '../fixtures';

/** Первая строка списка приоритетов: на ней и отмечаем. */
const FIRST = '.home__list .prow';

test('отмеченный блок виден сразу и переживает перезагрузку', async ({ page }) => {
  await openApp(page);
  await onboard(page);

  const row = page.locator(FIRST).first();
  const value = row.locator('.prow__value');
  // textContent, а не innerText: в разметке название лежит как есть, а на экране
  // его поднимает в капс CSS — и подпись кнопки «+» собрана из исходного.
  const title = (await row.locator('.prow__title').textContent()) ?? '';
  const add = row.getByRole('button', { name: 'Add 30 minutes: ' + title });

  // До первой отметки день пуст: прочерк вместо часов и приглашение вместо итога.
  await expect(value).toHaveText('—');
  await expect(page.locator('.home__lead')).toHaveText('Mark where your time went today');

  await add.click();

  await expect(value).toHaveText('30m');
  await expect(page.locator('.home__lead')).toContainText('Total:');
  await expect(page.locator('.home__lead strong')).toHaveText('30m');
  // Точки у «+» показывают отметки этого дня: одна отметка — одна точка.
  await expect(row.locator('.prow__today i')).toHaveCount(1);

  await add.click();
  await expect(value).toHaveText('1h');
  await expect(row.locator('.prow__today i')).toHaveCount(2);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tabbar').waitFor();

  const reloaded = page.locator(FIRST).first();
  await expect(reloaded.locator('.prow__title')).toHaveText(title);
  await expect(reloaded.locator('.prow__value')).toHaveText('1h');
  await expect(reloaded.locator('.prow__today i')).toHaveCount(2);
  await expect(page.locator('.home__lead strong')).toHaveText('1h');
});

test('лишнюю отметку можно снять, и ниже нуля счётчик не уходит', async ({ page }) => {
  await openApp(page);
  await onboard(page);

  const row = page.locator(FIRST).first();
  // textContent, а не innerText: в разметке название лежит как есть, а на экране
  // его поднимает в капс CSS — и подпись кнопки «+» собрана из исходного.
  const title = (await row.locator('.prow__title').textContent()) ?? '';
  await row.getByRole('button', { name: 'Add 30 minutes: ' + title }).click();
  await expect(row.locator('.prow__value')).toHaveText('30m');

  // Шторка счётчика открывается коротким нажатием на саму строку.
  await row.locator('.prow__main').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('1 block today');

  const remove = sheet.getByRole('button', { name: 'Remove 30 minutes' });
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(sheet).toContainText('0 blocks today');

  // Отрицательных блоков не бывает: на нуле «минус» гаснет.
  await expect(remove).toBeDisabled();

  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator(FIRST).first().locator('.prow__value')).toHaveText('—');
});

test('отметка уходит в выбранный прошлый день, а не в сегодня', async ({ page }) => {
  await openApp(page);
  await onboard(page);

  const row = page.locator(FIRST).first();
  // textContent, а не innerText: в разметке название лежит как есть, а на экране
  // его поднимает в капс CSS — и подпись кнопки «+» собрана из исходного.
  const title = (await row.locator('.prow__title').textContent()) ?? '';
  const add = row.getByRole('button', { name: 'Add 30 minutes: ' + title });

  await add.click();
  await expect(row.locator('.prow__today i')).toHaveCount(1);

  // Лента прошлых дней: сегодня стоит последним, вчера — предпоследним.
  await page.getByRole('button', { name: 'Fill in an earlier day' }).click();
  const days = page.locator('.dpick__day');
  await days.nth((await days.count()) - 2).click();

  await expect(page.locator('.dpast')).toContainText('Recording into');
  // Экран переехал на выбранный день: сегодняшние отметки на нём не считаются.
  await expect(row.locator('.prow__value')).toHaveText('—');

  await add.click();
  await expect(row.locator('.prow__value')).toHaveText('30m');
  await expect(page.locator('.home__lead')).toContainText('On ');

  await page.locator('.dpast').getByRole('button', { name: 'Back to today' }).click();
  await expect(row.locator('.prow__value')).toHaveText('30m');
  await expect(row.locator('.prow__today i')).toHaveCount(1);

  // Оба дня вместе видны в недельном окне — и после перезагрузки тоже.
  const week = page.locator('.app__sticky').getByRole('tab', { name: '7 days' });
  await week.click();
  await expect(page.locator('.home__lead strong')).toHaveText('1h');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tabbar').waitFor();
  await week.click();
  await expect(page.locator('.home__lead strong')).toHaveText('1h');
});

test('счётчик считает каждое нажатие, а не последнее', async ({ page }) => {
  await openApp(page);
  await onboard(page);

  const row = page.locator(FIRST).first();
  // textContent, а не innerText: в разметке название лежит как есть, а на экране
  // его поднимает в капс CSS — и подпись кнопки «+» собрана из исходного.
  const title = (await row.locator('.prow__title').textContent()) ?? '';
  const add = row.getByRole('button', { name: 'Add 30 minutes: ' + title });

  // Серия подряд: полчаса на нажатие, десять нажатий — пять часов.
  for (let i = 0; i < 10; i += 1) await add.click();

  await expect(row.locator('.prow__value')).toHaveText('5h');
  // Больше пяти точек в ряд не рисуется — дальше показывается числом.
  await expect(row.locator('.prow__today')).toHaveText('10');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tabbar').waitFor();
  await expect(page.locator(FIRST).first().locator('.prow__value')).toHaveText('5h');

  // Часы дошли и до статистики: один и тот же журнал на двух экранах.
  await tab(page, 'Stats').click();
  await expect(page.locator('.tile').first().locator('.tile__value')).toHaveText('5h');
});
