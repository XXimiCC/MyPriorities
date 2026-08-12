/*
 * Обновить копии, которыми живёт лендинг.
 *
 *   npm run landing:sync
 *
 * Лендинг — отдельный проект Vercel с Root Directory = landing, и файлы вне
 * своего каталога он в сборку не получает: это настраивается галкой в дашборде,
 * то есть связью, которую нельзя выразить в репозитории. Поэтому токены
 * оформления и кадры лежат копиями, а не импортируются из ../src и ../docs.
 *
 * Цена копий — расхождение. Его ловит tools/landing.test.ts при обычном
 * npm test: разъехавшийся токен обнаруживается там, а не глазом на проде.
 *
 * Иконки и превью ссылки сюда не входят — их пишет сразу в оба места
 * генератор tools/shots/brand.mjs (npm run brand).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LANDING_COPIES, LANDING_SHOTS } from './shots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function log(message) {
  process.stdout.write(`${message}\n`);
}

/** Та же оговорка, что у brand.mjs: не переписываем совпадающее, чтобы не пачкать git status. */
function copyIfChanged(from, to) {
  const source = path.join(ROOT, from);
  const target = path.join(ROOT, to);
  if (!fs.existsSync(source)) throw new Error(`нет источника ${from}`);

  const bytes = fs.readFileSync(source);
  if (fs.existsSync(target) && fs.readFileSync(target).equals(bytes)) return false;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  return true;
}

let total = 0;
let changed = 0;

for (const [from, to] of LANDING_COPIES) {
  total += 1;
  const isNew = copyIfChanged(from, path.posix.join('landing', to));
  if (isNew) changed += 1;
  log(`  ${isNew ? '~' : '='} landing/${to}`);
}

for (const shot of LANDING_SHOTS) {
  total += 1;
  const isNew = copyIfChanged(`docs/public/shots/${shot}`, `landing/public/shots/${shot}`);
  if (isNew) changed += 1;
  log(`  ${isNew ? '~' : '='} landing/public/shots/${shot}`);
}

/*
 * Лишнее убираем сами: кадр, выпавший из списка, иначе остался бы лежать в
 * сборке лендинга навсегда — сторож проверяет совпадение имеющихся копий, а не
 * отсутствие посторонних.
 */
const shotsDir = path.join(ROOT, 'landing', 'public', 'shots');
if (fs.existsSync(shotsDir)) {
  for (const name of fs.readdirSync(shotsDir)) {
    if (LANDING_SHOTS.includes(name)) continue;
    fs.rmSync(path.join(shotsDir, name));
    changed += 1;
    log(`  − landing/public/shots/${name}`);
  }
}

log(`\nГотово: ${total}, изменилось ${changed}.`);
