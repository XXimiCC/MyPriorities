/*
 * Собрать панель отладки для сайтов, у которых нет своего сборщика приложения.
 *
 *   npm run devkit:sync
 *
 * Документация и лендинг — отдельные проекты Vercel с Root Directory = docs и
 * = landing, и файлы вне своего каталога они в сборку не получают: это
 * настраивается галкой в дашборде, то есть связью, которую нельзя выразить в
 * репозитории. Импортировать `../src/devkit` оттуда невозможно, поэтому панель
 * собирается один раз здесь и кладётся готовыми файлами в public/ обоих сайтов.
 *
 * Тот же приём, что у tools/shots/brand.mjs с иконками. Цена копий —
 * расхождение; его ловит tools/devkit.test.ts при обычном npm test.
 *
 * Файлов получается несколько, и это намеренно: eager-часть (проверка доступа,
 * сочетание клавиш, значок) весит пару килобайт и грузится на каждой странице,
 * а React, съёмка кадра и сам слой приезжают отдельным куском в тот момент,
 * когда панель впервые открыли.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { build } from 'vite';

import { DEVKIT_COPIES } from './copies.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'node_modules', '.devkit-build');

function log(message) {
  process.stdout.write(`${message}\n`);
}

function stamp() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
  } catch {
    return 'dev';
  }
}

/** Та же оговорка, что у brand.mjs: не переписываем совпадающее, чтобы не пачкать git status. */
function copyIfChanged(from, to) {
  const bytes = fs.readFileSync(from);
  if (fs.existsSync(to) && fs.readFileSync(to).equals(bytes)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, bytes);
  return true;
}

await build({
  configFile: false,
  root: ROOT,
  // Относительные адреса: куски догружаются от места, где лежит сам файл, а не
  // от корня сайта. Иначе панель работала бы только в корне домена.
  base: './',
  logLevel: 'warn',
  // Иначе Vite прихватит в вывод весь public/ приложения — манифест, иконки и
  // service worker, которым на чужом сайте делать нечего.
  publicDir: false,
  define: {
    __DEVKIT_BUILD__: JSON.stringify(stamp()),
    __DEVKIT_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react()],
  build: {
    outDir: OUT,
    emptyOutDir: true,
    target: 'es2020',
    // Панель ставится на страницы, где своих модулей нет вовсе, — предупреждать
    // о размере одного куска не о чем.
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      input: path.join(ROOT, 'src', 'devkit', 'standalone.ts'),
      output: {
        entryFileNames: 'devkit.js',
        chunkFileNames: 'devkit-[name]-[hash].js',
        assetFileNames: 'devkit-[name]-[hash][extname]',
      },
    },
  },
});

const built = fs.readdirSync(OUT).filter((name) => !name.startsWith('.'));
if (!built.includes('devkit.js')) throw new Error('сборка не дала devkit.js');

let changed = 0;
for (const target of DEVKIT_COPIES) {
  const dir = path.join(ROOT, target);
  // Старые куски с прежними хешами убираются: иначе каталог растёт вечно, а
  // понять, какой файл настоящий, станет нельзя.
  if (fs.existsSync(dir)) for (const stale of fs.readdirSync(dir)) fs.rmSync(path.join(dir, stale));
  for (const name of built) if (copyIfChanged(path.join(OUT, name), path.join(dir, name))) changed += 1;
  log(`${target}: ${built.length} файлов`);
}

const total = built.reduce((sum, name) => sum + fs.statSync(path.join(OUT, name)).size, 0);
log(`\nВход devkit.js — ${(fs.statSync(path.join(OUT, 'devkit.js')).size / 1024).toFixed(1)} КБ`);
log(`Всего ${(total / 1024).toFixed(1)} КБ, записано файлов: ${changed}`);
