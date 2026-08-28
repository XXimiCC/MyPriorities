/*
 * Переход по вкладкам.
 *
 * Проверяется не подсветка выбранной кнопки, а то, что экран действительно
 * встал: у каждой вкладки берётся то, чего нет у соседей.
 */

import { expect, openApp, tab, test } from '../fixtures';

/** Вкладка → заголовок экрана и содержимое, которое есть только у неё. */
const SCREENS = [
  { name: 'Priorities', title: 'My Priorities', content: '.home__list .prow' },
  { name: 'Charge', title: 'Charge', content: '.charge__list .charge__option' },
  { name: 'Skills', title: 'Skills', content: '.sks__list li' },
  { name: 'Stats', title: 'Stats', content: '.tiles .tile' },
  { name: 'Settings', title: 'Settings', content: '.sset__lang button' },
] as const;

test('вкладки открывают свои экраны', async ({ page }) => {
  await openApp(page, { demo: 'max' });

  await expect(page.locator('.tabbar').getByRole('tab')).toHaveCount(SCREENS.length);

  for (const screen of SCREENS) {
    await tab(page, screen.name).click();

    await expect(page.locator('.header__title').first()).toHaveText(screen.title);
    await expect(tab(page, screen.name)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(screen.content).first()).toBeVisible();
  }
});

test('возврат на первую вкладку показывает её же, а не пустой экран', async ({ page }) => {
  await openApp(page, { demo: 'max' });

  await tab(page, 'Stats').click();
  await expect(page.locator('.tiles .tile').first()).toBeVisible();

  await tab(page, 'Priorities').click();
  await expect(page.locator('.home__list .prow').first()).toBeVisible();
  await expect(page.locator('.home__lead')).toContainText('Total:');
});
