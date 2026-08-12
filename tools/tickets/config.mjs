/*
 * Откуда командная строка берёт адрес и ключ.
 *
 * Переменные без приставки VITE_ намеренно: Vite подставляет в бандл только
 * VITE_*, поэтому ключ ниже структурно не может уехать в браузер. Это не
 * договорённость, а свойство сборки.
 *
 * Читается сперва окружение (так удобно в CI и в разовом запуске), потом
 * корневой .env.local — тот самый файл, где уже лежат адреса приложения.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Где лежат рабочие копии тикетов. В .gitignore: внутри кадры с настоящими данными. */
export const TICKETS_DIR = path.join(ROOT, '.tickets');

/**
 * Разбор .env-файла.
 *
 * Своя реализация на пятнадцать строк вместо dotenv: зависимость в корневом
 * package.json оплачивается каждой сборкой приложения на Vercel, а нужно тут
 * ровно «ключ=значение», комментарии и кавычки.
 */
export function parseEnvFile(text) {
  const values = {};

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const at = line.indexOf('=');
    if (at < 1) continue;

    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function fromFile() {
  const file = path.join(ROOT, '.env.local');
  if (!fs.existsSync(file)) return {};
  return parseEnvFile(fs.readFileSync(file, 'utf8'));
}

export function readConfig() {
  const file = fromFile();
  const url = process.env.DEVKIT_URL || file.DEVKIT_URL || process.env.VITE_DEVKIT_URL || file.VITE_DEVKIT_URL;
  const token = process.env.DEVKIT_TOKEN || file.DEVKIT_TOKEN;

  if (!url || !token) {
    throw new Error(
      'Нет DEVKIT_URL или DEVKIT_TOKEN. Пропишите их в .env.local (см. .env.example),\n' +
        'а на сервере поставьте ключ: wrangler secret put DEVKIT_TOKEN',
    );
  }

  return { url: url.replace(/\/+$/, ''), token };
}

/** Запрос к серверу тикетов. Ключ уходит своим заголовком — у панели дверь другая. */
export async function api(config, route, init = {}) {
  const response = await fetch(`${config.url}${route}`, {
    ...init,
    headers: { 'X-Devkit-Token': config.token, ...(init.headers ?? {}) },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${route}: сервер ответил ${response.status} ${body}`.trim());
  }

  return response;
}

export function log(message) {
  process.stdout.write(`${message}\n`);
}
