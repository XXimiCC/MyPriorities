/*
 * Утренний вопрос про ночь.
 *
 * Проверяется то, чего юнит-тест правила показать не может: шторка появляется
 * наутро, одно касание пишет обе отметки, а отказ не пишет ничего.
 *
 * Часы прогона стоят на 14:20 пятницы (fixtures.ts) и переводятся на утро
 * субботы — иначе ночь пришлось бы ждать по-настоящему.
 */

import { advanceMinutes, expect, onboard, openApp, tab, test } from '../fixtures';
import type { Page } from '@playwright/test';

/** С 14:20 пятницы до 07:00 субботы: та самая ночь, которую никто не отметил. */
const TO_MORNING = 16 * 60 + 40;

const nightSheet = (page: Page) =>
  page.getByRole('dialog', { name: 'The night is not marked' });

/** Вечерняя отметка и переход к утру: общее начало обоих прогонов. */
async function eveningThenMorning(page: Page): Promise<void> {
  await openApp(page);
  await onboard(page);

  await tab(page, 'Charge').click();
  await page.locator('.charge__option').filter({ hasText: 'Medium charge' }).click();
  await expect(page.locator('.charge__option--on')).toContainText('Medium charge');

  await advanceMinutes(page, TO_MORNING);
  await page.reload({ waitUntil: 'domcontentloaded' });
  /*
   * Ждём не панель вкладок, а вечернюю отметку в шапке: панель появляется
   * вместе с каркасом, а про ночь спрашивают по журналу — до его поднятия
   * шторки правильно нет.
   */
  await expect(page.getByRole('button', { name: 'Battery level' }).getByRole('img')).toHaveAttribute(
    'aria-label',
    'Medium charge',
  );
}

test('утро после ночи без отметок: одно касание пишет обе отметки', async ({ page }) => {
  await eveningThenMorning(page);

  const night = nightSheet(page);
  await expect(night).toBeVisible();

  // Обычный случай: в поле стоит 23:00, пока своего ответа на устройстве нет.
  const bedtime = night.locator('.night__time input');
  await expect(bedtime).toHaveValue('23:00');

  /*
   * Нижняя граница. 10:00 разрешилось бы во вчерашние сутки — то есть раньше
   * вечерней отметки в 14:20, — и такая отметка ничего бы не починила.
   */
  await bedtime.fill('10:00');
  await expect(night).toContainText('not later than your last mark');
  await expect(night.getByRole('button', { name: /Full charge/ })).toBeDisabled();

  // Легли после полуночи: 01:30 — это уже сегодняшние сутки, минута 90.
  await bedtime.fill('01:30');
  await night.getByRole('button', { name: /Full charge/ }).click();
  await expect(night).toBeHidden();

  // Обе отметки на месте: ночь «Заряжаюсь», утро — выбранным состоянием.
  await tab(page, 'Charge').click();
  const shifts = page.locator('.bshifts__row');
  await expect(shifts).toHaveCount(2);
  await expect(shifts.nth(0)).toContainText('01:30');
  await expect(shifts.nth(0)).toContainText('Recharging');
  await expect(shifts.nth(1)).toContainText('07:00');
  await expect(shifts.nth(1)).toContainText('Full charge');

  // И вопрос не возвращается: ночь отмечена, спрашивать больше не о чем.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tabbar').waitFor();
  await expect(nightSheet(page)).toBeHidden();
});

test('отказ ничего не пишет и до завтра не возвращается', async ({ page }) => {
  await eveningThenMorning(page);

  const night = nightSheet(page);
  await expect(night).toBeVisible();
  // Нажатие мимо панели — тот же путь, что свайп и системная «назад».
  await night.locator('.sheet__scrim').click({ position: { x: 20, y: 20 } });
  await expect(night).toBeHidden();

  // Сегодняшний день так и остался пустым: молча мы не пишем ничего.
  await tab(page, 'Charge').click();
  await expect(page.locator('.bshifts__row')).toHaveCount(0);
  await expect(page.locator('.app__body')).toContainText('Nothing switched on this day');

  // Отмахнулись — значит отмахнулись: перезапуск вопрос не возвращает.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tabbar').waitFor();
  await expect(nightSheet(page)).toBeHidden();
});
