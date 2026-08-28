/*
 * Заряд: отметка состояния и то, где она видна.
 *
 * Мест, где человек видит результат, три, и они не связаны кодом напрямую:
 * батарейка в шапке (стоит на каждой вкладке), герой экрана «Заряд» и лента
 * отметок дня. Проверяются все три — расхождение между ними как раз и означает
 * «нажал, а ничего не изменилось».
 */

import { advanceMinutes, expect, onboard, openApp, tab, test } from '../fixtures';

test('состояние заряда переключается и видно везде, где его показывают', async ({ page }) => {
  await openApp(page);
  await onboard(page);

  // До первой отметки в шапке стоит приглашение, а не батарейка.
  const headerBattery = page.getByRole('button', { name: 'Battery level' });
  await expect(headerBattery).toHaveText('Charge?');

  await tab(page, 'Charge').click();
  await expect(page.locator('.charge__hero')).toContainText('No charge marked yet');
  await expect(page.locator('.bshifts__row')).toHaveCount(0);

  const full = page.locator('.charge__option').filter({ hasText: 'Full charge' });
  await full.click();

  // Герой экрана, выбранный пункт списка и лента отметок — все трое.
  await expect(page.locator('.charge__hero')).toContainText('The clock is running');
  await expect(page.locator('.charge__hero').getByRole('img')).toHaveAttribute('aria-label', 'Full charge');
  await expect(page.locator('.charge__option--on')).toHaveCount(1);
  await expect(page.locator('.charge__option--on')).toContainText('Full charge');

  const shifts = page.locator('.bshifts__row');
  await expect(shifts).toHaveCount(1);
  await expect(shifts.first()).toContainText('Full charge');
  await expect(shifts.first()).toContainText('until now');

  // Шапка догнала: приглашение сменилось батарейкой нужного уровня.
  await expect(headerBattery).not.toHaveText('Charge?');
  await expect(headerBattery.getByRole('img')).toHaveAttribute('aria-label', 'Full charge');

  /*
   * Второе состояние в ту же минуту заменяет первое, а не встаёт рядом: отметка
   * — это момент смены, и двух состояний в одну минуту не бывает. Часы в тестах
   * стоят (см. fixtures.ts), поэтому оба нажатия попадают в одну и ту же минуту.
   */
  await page.locator('.charge__option').filter({ hasText: 'Medium charge' }).click();
  await expect(page.locator('.charge__option--on')).toContainText('Medium charge');
  await expect(shifts).toHaveCount(1);
  await expect(shifts.first()).toContainText('Medium charge');
  await expect(headerBattery.getByRole('img')).toHaveAttribute('aria-label', 'Medium charge');

  // Состояние переживает перезагрузку так же, как отметки времени.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tabbar').waitFor();
  await expect(page.getByRole('button', { name: 'Battery level' }).getByRole('img')).toHaveAttribute(
    'aria-label',
    'Medium charge',
  );
});

test('заряд меняется и из шапки, на любой вкладке', async ({ page }) => {
  await openApp(page);
  await onboard(page);

  // Шапка есть на каждом экране — берём тот, где списка состояний нет вовсе.
  await tab(page, 'Stats').click();
  const headerBattery = page.getByRole('button', { name: 'Battery level' });
  await headerBattery.click();

  const sheet = page.getByRole('dialog', { name: 'How much charge' });
  await sheet.getByRole('button', { name: /Recharging/ }).click();

  await expect(sheet).toBeHidden();
  await expect(headerBattery.getByRole('img')).toHaveAttribute('aria-label', 'Recharging');

  // И тот же ответ на экране «Заряд»: источник у обоих один.
  await tab(page, 'Charge').click();
  await expect(page.locator('.charge__option--on')).toContainText('Recharging');
});

test('переход «на нуле» спрашивает, что съело энергию', async ({ page }) => {
  await openApp(page);
  await onboard(page);
  await tab(page, 'Charge').click();

  await page.locator('.charge__option').filter({ hasText: 'Running on empty' }).click();

  const drain = page.getByRole('dialog');
  await expect(drain).toContainText('What drained you?');
  // Ответы — это список приоритетов человека, а не готовый справочник.
  await expect(drain.getByRole('button', { name: 'Work' })).toBeVisible();

  await drain.getByRole('button', { name: 'Work' }).click();
  await expect(drain).toBeHidden();
  await expect(page.locator('.charge__option--on')).toContainText('Running on empty');

  /*
   * Причина доехала до статистики — иначе вопрос был бы задан впустую.
   *
   * Часы переводятся на полчаса вперёд: разбор заряда на статистике появляется
   * от длительности, а только что поставленная отметка длится ноль минут.
   */
  await advanceMinutes(page, 30);
  await tab(page, 'Stats').click();
  await expect(page.locator('.app__body')).toContainText('What drains your battery');
  await expect(page.locator('.blist').last().locator('.blist__title')).toHaveText('Work');
});
