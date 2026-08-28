/*
 * Демо как основа для чтения.
 *
 * `?demo=max` открывает готовый профиль с тринадцатью месяцами истории — без
 * входа, без сети и без записи на диск (src/demo/mode.ts). Это единственный
 * набор данных в проекте, который выглядит как жизнь и при этом одинаков в
 * каждом прогоне.
 */

import { expect, onboard, openApp, tab, test } from '../fixtures';

test.describe('демо-режим', () => {
  test('открывается и показывает настоящие данные на приоритетах', async ({ page }) => {
    await openApp(page, { demo: 'max' });

    await expect(page.locator('.header__title').first()).toHaveText('My Priorities');
    // Плашка гостя — признак того, что открыт именно чужой профиль, а не свой.
    await expect(page.locator('.demobar')).toContainText('Maximum');

    const rows = page.locator('.home__list .prow');
    await expect(rows).toHaveCount(10);
    // Ни одна строка не пустая: у профиля есть и список, и названия.
    for (const title of await rows.locator('.prow__title').allTextContents()) {
      expect(title.trim().length).toBeGreaterThan(0);
    }

    /*
     * «Настоящие данные» проверяются числом, а не наличием разметки: пустой
     * журнал дал бы тот же список строк, но с прочерками вместо часов и с
     * приглашением «отметьте, куда ушло время» вместо итога.
     */
    const lead = page.locator('.home__lead');
    await expect(lead).toContainText('Total:');
    await expect(lead.locator('strong')).toHaveText(/\d/);
    await expect(lead).toContainText('Leader:');

    // Полоса лидера залита: доли считаются от него, и ноль означал бы пустой день.
    const width = await rows.first().locator('.bar__fill').evaluate((n) => n.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(0);
  });

  test('история за месяц и за всё время накапливается, а не повторяется', async ({ page }) => {
    await openApp(page, { demo: 'max' });
    await tab(page, 'Stats').click();

    const total = page.locator('.tile').first().locator('.tile__value');
    const periods = page.locator('.pswitch').getByRole('tab');

    await periods.filter({ hasText: '7 days' }).click();
    const week = await total.innerText();

    await periods.filter({ hasText: '30 days' }).click();
    await expect(total).not.toHaveText(week);
    const month = await total.innerText();

    await periods.filter({ hasText: 'All time' }).click();
    await expect(total).not.toHaveText(month);

    const hours = (text: string): number => Number(text.replace(/[^\d.]/g, ''));
    expect(hours(await total.innerText())).toBeGreaterThan(hours(month));
    expect(hours(month)).toBeGreaterThan(hours(week));
  });

  test('гость видит профиль заново: его тычки не остаются', async ({ page }) => {
    await openApp(page, { demo: 'max' });
    const value = page.locator('.home__list .prow').first().locator('.prow__value');
    const before = await value.innerText();

    // Кнопка работает — иначе демо выглядело бы сломанным приложением.
    await page.locator('.home__list .prow').first().locator('.prow__add').click();
    await expect(value).not.toHaveText(before);

    await openApp(page, { demo: 'max' });
    await expect(page.locator('.home__list .prow').first().locator('.prow__value')).toHaveText(before);
  });

  test('демо не трогает данные владельца', async ({ page }) => {
    /*
     * Главное обещание режима: приложение показывают другому человеку на своём
     * телефоне. Хранилище подменяется памятью на границе (src/store/local/db.ts),
     * и проверяется это снаружи — тем, что владелец видит после выхода.
     *
     * Заряд взят намеренно: его отметки не привязаны к списку приоритетов, и
     * протёкшая наружу запись видна сразу же, в шапке на любой вкладке.
     */
    await openApp(page);
    await onboard(page);
    const own = page.getByRole('button', { name: 'Battery level' });
    await expect(own).toHaveText('Charge?');

    await openApp(page, { demo: 'max' });
    await tab(page, 'Charge').click();
    await page.locator('.charge__option').filter({ hasText: 'Recharging' }).click();
    await expect(page.locator('.charge__option--on')).toContainText('Recharging');

    await openApp(page);
    await expect(page.getByRole('button', { name: 'Battery level' })).toHaveText('Charge?');
  });
});
