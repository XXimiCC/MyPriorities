/*
 * Маленький экран.
 *
 * Приложение уезжает мини-аппом в Telegram, где ширина окна — ширина телефона,
 * а внизу ещё и панель клиента. Проверяется то, что человек замечает первым:
 * страница не уезжает вбок, ничего не торчит за край и управление не срезано.
 */

import type { Page } from '@playwright/test';

import { expect, openApp, tab, test } from '../fixtures';

/** Тот же размер, что у съёмки документации, и на две ступени меньше — SE. */
const SIZES = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
];

const TABS = ['Priorities', 'Charge', 'Skills', 'Stats', 'Settings'];

/**
 * Что не помещается по ширине.
 *
 * Меряется не положение элемента, а ширина содержимого его контейнера: узел,
 * уехавший за край, растягивает контейнер, и это видно снаружи независимо от
 * того, обрежет его `overflow: hidden` или добавит вторую полосу прокрутки.
 * Обрезанное таким способом управление недостижимо ровно так же, как уехавшее.
 *
 * Два исключения, и оба намеренные:
 *   .dpick — лента прошлых дней. Её листают вбок, на то она и лента.
 *   ellipsis — многоточие: обрезка длинного названия здесь и есть ответ на
 *     длинное название, а не поломка раскладки.
 */
async function tooWide(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const node of document.querySelectorAll('.app, .app *')) {
      if (node.scrollWidth <= node.clientWidth + 1) continue;
      if (node.closest('.dpick')) continue;
      if (getComputedStyle(node).textOverflow === 'ellipsis') continue;
      out.push(
        `${node.className || node.tagName} (${node.scrollWidth} в ${node.clientWidth}) ${
          (node.textContent ?? '').trim().slice(0, 40)
        }`,
      );
    }
    return out;
  });
}

for (const size of SIZES) {
  test.describe(`экран ${size.width}×${size.height}`, () => {
    test.use({ viewport: size });

    test('экраны встают по ширине, панель вкладок цела', async ({ page }) => {
      await openApp(page, { demo: 'max' });

      for (const name of TABS) {
        await tab(page, name).click();
        await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');

        // Страница не прокручивается вбок: это первое, что видно на телефоне.
        const scroll = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth,
          window: window.innerWidth,
        }));
        expect(scroll.document, `${name}: страница уехала вбок`).toBeLessThanOrEqual(scroll.window);

        expect(await tooWide(page), `${name}: содержимое шире экрана`).toEqual([]);

        // Панель вкладок стоит целиком в окне: срезанная кнопка ненажимаема.
        const bar = await page.locator('.tabbar').boundingBox();
        expect(bar).not.toBeNull();
        expect(bar!.x).toBeGreaterThanOrEqual(0);
        expect(bar!.x + bar!.width).toBeLessThanOrEqual(size.width);
        expect(bar!.y + bar!.height).toBeLessThanOrEqual(size.height + 1);

        for (const button of await page.locator('.tabbar').getByRole('tab').all()) {
          const box = await button.boundingBox();
          expect(box).not.toBeNull();
          // Меньше сорока точек по любой стороне — уже не палец, а прицеливание.
          expect(box!.height, `${name}: кнопка вкладки срезана по высоте`).toBeGreaterThanOrEqual(40);
          expect(box!.width, `${name}: кнопка вкладки срезана по ширине`).toBeGreaterThanOrEqual(40);
        }

        // Низ длинного экрана проверяется отдельно: там живут кнопки действий.
        await page.locator('.app__body').first().evaluate((node) => {
          node.scrollTop = node.scrollHeight;
        });
        expect(await tooWide(page), `${name}: содержимое шире экрана после прокрутки`).toEqual([]);
      }
    });

    test('первый запуск и правка списка тоже помещаются', async ({ page }) => {
      // Онбординг и вложенные экраны стоят без панели вкладок — своя раскладка.
      await openApp(page);
      await expect(page.locator('.onb__title')).toBeVisible();
      expect(await tooWide(page), 'онбординг').toEqual([]);

      await page.getByRole('button', { name: 'Skip' }).click();
      await expect(page.locator('.pcard').first()).toBeVisible();
      expect(await tooWide(page), 'выбор набора').toEqual([]);

      await page.locator('.pcard').first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await tooWide(page), 'шторка набора').toEqual([]);
    });
  });
}
