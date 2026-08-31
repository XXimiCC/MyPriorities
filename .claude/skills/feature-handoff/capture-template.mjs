/*
 * Образец разовой съёмки своей фичи. Копировать в tools/shots/<фича>.local.mjs
 * (в другом месте не разрешится `playwright`), заполнить scene() и запустить:
 *
 *   npm run shots:setup      # один раз: playwright + chromium
 *   npm run build            # снимаем собранное, не dev-сервер
 *   node tools/shots/<фича>.local.mjs
 *
 * Скрипт и кадры в .shots/ — оснастка одной сдачи, коммитить их не нужно.
 * Постоянные кадры документации живут в tools/shots/scenarios.mjs.
 *
 * Всё, что ниже настройки контекста, скопировано из tools/shots/capture.mjs.
 * Самое важное там — reducedMotion: 'reduce'. Шторки въезжают анимацией с
 * opacity 0 -> 1 за 0.28 с, и кадр посреди неё выходит полупрозрачным: панель
 * просвечивает, текст сливается с фоном. Приложение схлопывает анимации до
 * 0.01 мс в @media (prefers-reduced-motion), поэтому под 'reduce' шторка стоит
 * на месте уже в первом кадре.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, '.shots');
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

/** Порт не 4173: тот занимает съёмка документации, если она идёт рядом. */
const PORT = 4188;
const BASE = `http://127.0.0.1:${PORT}`;

/** Пятница 31 июля 2026, 14:20 — тот же момент, что в e2e/fixtures.ts. */
const FIXED_TIME = new Date('2026-07-31T14:20:00+03:00');

/** Язык кадров — язык задачи; локаторы берутся из той же локали. */
const LANG = 'ru';

const STEADY_CSS = `
  *, *::before, *::after { caret-color: transparent !important; }
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
`;

async function startPreview() {
  const child = spawn(
    process.execPath,
    [VITE_BIN, 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore' },
  );
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error('preview упал, не успев подняться');
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return child;
    } catch {
      /* ещё не слушает — это ожидаемо */
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('preview не поднялся за 30 секунд');
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Два кадра после готовности шрифтов: вёрстка успевает встать окончательно. */
async function settle(page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

async function shoot(page, name) {
  await settle(page);
  const buffer = await page.screenshot();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.png`), buffer);
  process.stdout.write(`  ${name}.png  ${buffer.length} B\n`);
}

/** Домотать до нужного блока: доказательство фичи часто ниже сгиба. */
async function scrollTo(page, selector) {
  await page
    .locator(selector)
    .first()
    .evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
}

async function makePage(browser, viewport = { width: 390, height: 844 }, params = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    // dayKey() считает локальную дату: без фиксации пояса кадры уедут на день.
    timezoneId: 'Europe/Moscow',
    colorScheme: 'dark',
    // Без этого шторки снимаются посреди анимации и выходят прозрачными.
    reducedMotion: 'reduce',
  });
  // Настоящий SDK Telegram не нужен, а index.html ходит за ним всегда.
  await context.route('**/telegram-web-app.js', (route) => route.fulfill({ body: '' }));

  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  await page.clock.setFixedTime(FIXED_TIME);

  // devkit=0 гасит панель отладки: на локальном адресе она считает машину своей.
  const query = new URLSearchParams({ devkit: '0', lang: LANG, ...params });
  await page.goto(`${BASE}/?${query}`, { waitUntil: 'domcontentloaded' });
  // Единственный надёжный маркер готовности: класс снимается после ready в сторе.
  await page.waitForSelector('.app:not(.app--loading)', { timeout: 20_000 });
  await page.addStyleTag({ content: STEADY_CSS });
  return page;
}

/** Первый запуск: без набора приоритетов отмечать нечего. */
async function onboard(page) {
  await page.getByRole('button', { name: 'Пропустить' }).click();
  await page.locator('.pcard').first().click();
  await page.getByRole('button', { name: 'Применить набор' }).click();
  await page.locator('.tabbar').waitFor();
}

/** Перевести часы страницы вперёд — чтобы не ждать по-настоящему. */
async function advanceMinutes(page, minutes) {
  await page.clock.setFixedTime(new Date(FIXED_TIME.getTime() + minutes * 60_000));
}

const tab = (page, label) =>
  page.locator('.tabbar').getByRole('tab', { name: label, exact: true });

// --- Заполнить под свою фичу -----------------------------------------------

async function scene(browser) {
  const page = await makePage(browser);
  await onboard(page);

  // …довести приложение до состояния, которое показывает фичу…

  await shoot(page, '01-обычное-состояние');

  // …граничный случай…
  // await shoot(page, '02-запертое-состояние');

  // …результат действия: он и есть доказательство…
  // await scrollTo(page, '.где-видно-запись');
  // await shoot(page, '03-результат');

  // Узкий экран, если что-то могло не поместиться.
  // const narrow = await makePage(browser, { width: 320, height: 568 });
  // await shoot(narrow, '04-узкий-экран');
}

// ---------------------------------------------------------------------------

async function main() {
  const preview = await startPreview();
  const browser = await chromium.launch();
  try {
    await scene(browser);
  } finally {
    await browser.close();
    preview.kill();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
