/*
 * Навыки: завести, наполнить, переименовать, убрать и вернуть.
 *
 * Лестница навыков — единственная часть приложения, где заведённое живёт годами
 * и правится по частям: название, цвет, «уже вложено». Правки сохраняются по
 * потере фокуса, а не по кнопке, — то есть тем способом, который легче всего
 * сломать незаметно.
 *
 * Всё в обычном режиме: в демо запись выключена на границе хранилища.
 */

import { acceptDialogs, expect, onboard, openApp, tab, test } from '../fixtures';

/*
 * Настоящий список — прямой ребёнок тела экрана. Витрина пустого экрана
 * (src/skills/SkillsEmpty.tsx) собрана тем же компонентом строки и лежит в том
 * же классе, поэтому без этого уточнения три размытых примера считались бы
 * навыками человека.
 */
const ROWS = '.app__body > .sks__list .srow';

/** Завести навык своим названием, минуя список готовых. */
async function addSkill(page: import('@playwright/test').Page, title: string, hours: string) {
  const sheet = page.getByRole('dialog', { name: 'New skill' });
  await sheet.getByRole('tab', { name: 'Add your own' }).click();
  await sheet.locator('input.field').fill(title);
  await sheet.locator('input[type=number]').fill(hours);
  await sheet.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(sheet).toBeHidden();
}

test('навык заводится, копит часы и переживает перезагрузку', async ({ page }) => {
  await openApp(page);
  await onboard(page);
  await tab(page, 'Skills').click();

  // Пустой экран показывает витрину и одну кнопку — второй такой же под ней нет.
  await expect(page.locator('.sksx__add')).toHaveText('Add a skill');
  await expect(page.locator(ROWS)).toHaveCount(0);

  await page.locator('.sksx__add').click();
  await addSkill(page, 'Guitar', '100');

  const row = page.locator(ROWS).filter({ hasText: 'Guitar' });
  await expect(row).toHaveCount(1);
  // Стартовый капитал доехал: сто часов, а не ноль.
  await expect(row.locator('.srow__hours')).toContainText('100');
  await expect(page.locator('.sks__total')).toContainText('100');

  await row.getByRole('button', { name: 'Add 30 minutes: Guitar' }).click();
  await expect(row.locator('.srow__hours')).toContainText('100.5');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tabbar').waitFor();
  await tab(page, 'Skills').click();

  const back = page.locator(ROWS).filter({ hasText: 'Guitar' });
  await expect(back).toHaveCount(1);
  await expect(back.locator('.srow__hours')).toContainText('100.5');
});

test('навык правится: название и «уже вложено» сохраняются по потере фокуса', async ({ page }) => {
  await openApp(page);
  await onboard(page);
  await tab(page, 'Skills').click();
  await page.locator('.sksx__add').click();
  await addSkill(page, 'Guitar', '10');

  await page.locator(ROWS).locator('.srow__main').click();
  const sheet = page.getByRole('dialog', { name: 'Skill' });
  await expect(sheet).toBeVisible();

  /*
   * blur здесь не украшение, а само действие: кнопки «сохранить» в шторке нет.
   * Уход из поля — то же, что делает человек, ткнув в следующее.
   */
  const name = sheet.locator('input.field');
  await name.fill('Bass');
  await name.blur();

  const hours = sheet.locator('input[type=number]').first();
  await hours.fill('250');
  await hours.blur();

  // Escape, а не клик по затемнению: панель шторки перекрывает его целиком.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  const row = page.locator(ROWS);
  await expect(row).toHaveCount(1);
  await expect(row.locator('.srow__title')).toHaveText('Bass');
  await expect(row.locator('.srow__hours')).toContainText('250');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tabbar').waitFor();
  await tab(page, 'Skills').click();
  await expect(page.locator(ROWS).locator('.srow__title')).toHaveText('Bass');
  await expect(page.locator(ROWS).locator('.srow__hours')).toContainText('250');
});

test('удалённый навык уходит в архив с часами и возвращается с ними же', async ({ page }) => {
  acceptDialogs(page);

  await openApp(page);
  await onboard(page);
  await tab(page, 'Skills').click();
  await page.locator('.sksx__add').click();
  await addSkill(page, 'Guitar', '40');

  await page.locator(ROWS).locator('.srow__main').click();
  await page.getByRole('dialog', { name: 'Skill' }).getByRole('button', { name: 'Delete skill' }).click();

  await expect(page.locator(ROWS)).toHaveCount(0);
  const archive = page.locator('.sks__archive li');
  await expect(archive).toHaveCount(1);
  await expect(archive).toContainText('Guitar');
  await expect(archive).toContainText('40');

  /*
   * Обещание вопроса перед удалением, дословно: «add a skill with the same name
   * and they come back». Часы возвращаются вместе с названием — и приходят
   * СОРОК, а не десять, которые набраны в форме возврата.
   */
  await page.locator('.sksx__add').click();
  await addSkill(page, 'Guitar', '10');

  await expect(page.locator('.sks__archive li')).toHaveCount(0);
  await expect(page.locator(ROWS).locator('.srow__hours')).toContainText('40');
});
