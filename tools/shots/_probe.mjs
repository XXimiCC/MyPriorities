import { chromium } from 'playwright';
const OUT = process.argv[2];
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP docs.example 127.0.0.1'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 860 } });
page.on('console', (m) => { if (m.type() === 'error' || /devkit/i.test(m.text())) console.log('[c]', m.type(), m.text().slice(0, 180)); });

// Bez klyucha: otkaz dolzhen nazyvat vyhod.
await page.goto('http://localhost:4180/dev/devkit', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.locator('[data-devkit] button[title]').click();
await page.waitForSelector('.dkc__note, .dks__frame canvas', { timeout: 30000 });
if (await page.locator('.dks__frame canvas').count()) {
  await page.getByRole('button', { name: 'Всё окно' }).click();
  await page.waitForSelector('.dka__frame', { timeout: 10000 });
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.waitForSelector('.dkc__note', { timeout: 20000 });
}
await page.locator('.dkc__note').fill('Проверка без ключа');
await page.getByRole('button', { name: 'Отправить' }).click();
await page.waitForTimeout(2000);
console.log('bez klyucha →', await page.locator('.dkc__status').textContent());
await page.close();

// S klyuchom v adrese: dolzhno uyti.
const page2 = await browser.newPage({ viewport: { width: 1100, height: 860 } });
page2.on('console', (m) => { if (m.type() === 'error') console.log('[c2]', m.text().slice(0, 180)); });
await page2.goto('http://localhost:4180/dev/devkit?test=local-invite-456', { waitUntil: 'networkidle' });
await page2.waitForTimeout(600);
await page2.locator('[data-devkit] button[title]').click();
await page2.waitForSelector('.dks__frame canvas', { timeout: 30000 });
await page2.getByRole('button', { name: 'Всё окно' }).click();
await page2.waitForSelector('.dka__frame', { timeout: 10000 });
await page2.getByRole('button', { name: 'Дальше' }).click();
await page2.waitForSelector('.dkc__note', { timeout: 20000 });
await page2.locator('.dkc__note').fill('С документации: съехал отступ в списке');
await page2.getByRole('button', { name: 'Отправить' }).click();
await page2.waitForSelector('[data-devkit-toast]', { timeout: 20000 });
console.log('s klyuchom →', await page2.locator('[data-devkit-toast]').textContent());
await page2.screenshot({ path: `${OUT}/docs-toast.png` });
await browser.close();
