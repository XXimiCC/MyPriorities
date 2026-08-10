/*
 * Пересборка скриншотов для документации.
 *
 *   npm run docs:shots              — все снимки
 *   npm run docs:shots -- home      — только те, чьё имя начинается с «home»
 *   npm run docs:shots -- --no-build  — не пересобирать приложение
 *
 * Приложение поднимается собранным (vite preview), а не dev-сервером: в dev
 * висит клиент HMR и оверлей ошибок, а при ?mock=1 ещё и водопад из сотни
 * запросов модулей. Снимать надо ровно то, что уедет на прод.
 *
 * Каждый снимок получает свежий контекст браузера. Это дороже общей страницы на
 * ~100 мс, но снимает целый класс проблем: в прогоне без мока приложение пишет в
 * localStorage, и состояние предыдущего снимка протекало бы в следующий.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RUNS } from './scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(ROOT, 'docs', 'public', 'shots');
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const STUB = fs.readFileSync(path.join(HERE, 'telegram-stub.js'), 'utf8');

const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;

/*
 * Пятница 31 июля 2026 года. Дата не случайная сразу по двум причинам: она
 * совпадает с сидом генератора демо-данных (src/store/mock.ts), а пятница даёт в
 * тридцатидневном окне достаточно и будних, и выходных дней — иначе наблюдение
 * «в будни выходит …, в выходные …» промолчит и снимка не будет.
 */
const FIXED_TIME = new Date('2026-07-31T14:20:00+03:00');

/**
 * Патч, который выключает то, что мигает и потому даёт разные байты.
 *
 * Отметки сборки и версии сервера скрыты по той же причине: они меняются на
 * каждой пересборке, и снимок настроек переписывался бы всякий раз, хотя на
 * экране ничего содержательного не поменялось.
 */
const STEADY_CSS = `
  *, *::before, *::after { caret-color: transparent !important; }
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
  .sset__build { display: none !important; }
`;

/** Раскладка для длинных экранов: снять их целиком иначе нельзя. */
const TALL_CSS = `
  .app { height: auto !important; overflow: visible !important; }
  .app__body { overflow: visible !important; }
  .tabbar { display: none !important; }
`;

const args = process.argv.slice(2);
const noBuild = args.includes('--no-build');
const filters = args.filter((a) => !a.startsWith('--'));

function log(message) {
  process.stdout.write(`${message}\n`);
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: ROOT, stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} завершился с кодом ${code}`)),
    );
  });
}

/** Сборка без tsc: проверка типов к скриншотам отношения не имеет и только тормозит. */
async function buildApp() {
  log('Собираю приложение…');
  await run(process.execPath, [VITE_BIN, 'build']);
}

async function startPreview() {
  log(`Поднимаю preview на ${BASE}…`);
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
      /* сервер ещё не слушает — это ожидаемо */
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('preview не поднялся за 30 секунд');
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function makeContext(browser, { telegram }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    // Обязательно: dayKey() считает локальную дату, и без фиксации пояса
    // снимки на машине в другом часовом поясе разъедутся на день.
    timezoneId: 'Europe/Moscow',
    colorScheme: 'dark',
    // Приложение само схлопывает переходы до 0.01 мс в @media (prefers-reduced-motion).
    reducedMotion: 'reduce',
  });

  // Настоящий SDK Telegram не нужен ни в одном прогоне: в прогонах A и B он
  // только тянет сеть, в прогоне C его заменяет стаб.
  await context.route('**/telegram-web-app.js', (route) => route.fulfill({ body: '' }));
  if (telegram) await context.addInitScript(STUB);

  return context;
}

async function openApp(context, url) {
  const page = await context.newPage();

  // confirmDialog вне Telegram уходит в window.confirm. Без обработчика любой
  // сценарий с удалением или применением набора встанет насмерть.
  page.on('dialog', (dialog) => void dialog.accept());

  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });

  // Единственный надёжный маркер готовности: класс app--loading снимается
  // только после того, как стор отдал ready (src/App.tsx:79). networkidle тут
  // не помогает — приложение не ходит в сеть вовсе.
  await page.waitForSelector('.app:not(.app--loading)', { timeout: 20_000 });
  await page.addStyleTag({ content: STEADY_CSS });
  return page;
}

/** Два кадра после готовности шрифтов: верстка успевает встать окончательно. */
async function settle(page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.evaluate(
    () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function shoot(page, shot) {
  if (shot.tall) await page.addStyleTag({ content: TALL_CSS });

  /*
   * Настройки и статистика длиннее экрана, а нужен обычный телефонный кадр
   * конкретного блока. scrollIntoView с block:'start' даёт воспроизводимое
   * положение, в отличие от scrollIntoViewIfNeeded, который домотает минимально.
   */
  if (shot.scrollTo) {
    await page
      .locator(shot.scrollTo)
      .first()
      .evaluate((node) => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
  }

  await settle(page);

  if (shot.target) {
    return page.locator(shot.target).first().screenshot();
  }
  return page.screenshot({ fullPage: Boolean(shot.tall) });
}

/*
 * Пишем файл только когда байты отличаются.
 *
 * Рендер Chromium детерминирован, поэтому неизменившийся экран даёт тот же PNG.
 * Перезапись всех сорока файлов на каждом прогоне превратила бы git status в шум,
 * в котором настоящее изменение не найти.
 */
function writeIfChanged(name, buffer) {
  const file = path.join(OUT_DIR, `${name}.png`);
  if (fs.existsSync(file) && fs.readFileSync(file).equals(buffer)) return false;
  fs.writeFileSync(file, buffer);
  return true;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!noBuild) await buildApp();

  const preview = await startPreview();
  const browser = await chromium.launch();

  let total = 0;
  let changed = 0;
  const failures = [];

  try {
    for (const runDef of RUNS) {
      const shots = filters.length
        ? runDef.shots.filter((shot) => filters.some((f) => shot.name.startsWith(f)))
        : runDef.shots;
      if (shots.length === 0) continue;

      log(`\n— прогон «${runDef.id}»: ${shots.length} снимков`);

      for (const shot of shots) {
        total += 1;
        const context = await makeContext(browser, { telegram: Boolean(runDef.telegram) });
        try {
          const page = await openApp(context, runDef.url);
          if (shot.setup) await shot.setup(page);
          const buffer = await shoot(page, shot);
          const isNew = writeIfChanged(shot.name, buffer);
          if (isNew) changed += 1;
          log(`  ${isNew ? '~' : '='} ${shot.name}`);
        } catch (error) {
          failures.push({ name: shot.name, message: error.message.split('\n')[0] });
          log(`  ! ${shot.name}: ${error.message.split('\n')[0]}`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    preview.kill();
  }

  log(`\nИзменилось ${changed} из ${total}.`);
  if (failures.length > 0) {
    log(`Не сняты: ${failures.map((f) => f.name).join(', ')}`);
    process.exitCode = 1;
  }
}

await main();
