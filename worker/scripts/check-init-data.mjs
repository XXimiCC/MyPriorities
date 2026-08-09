/*
 * Сверяет подпись initData с токеном — независимо от кода Worker.
 *
 * Нужен, когда вход отвергается, а причина неочевидна. Реализация здесь
 * намеренно своя, на node:crypto, и написана по документации заново: если бы
 * она просто звала ту же функцию, что и Worker, общая ошибка прошла бы
 * незамеченной, и проверка не проверяла бы ничего.
 *
 *   node scripts/check-init-data.mjs "<initData>" [токен]
 *
 * Токен берётся из аргумента, из TELEGRAM_BOT_TOKEN или из .dev.vars.
 * Никуда не отправляется: всё считается локально.
 */

import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function readToken(fromArg) {
  if (fromArg) return fromArg.trim();
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN.trim();

  const vars = path.join(HERE, '..', '.dev.vars');
  if (fs.existsSync(vars)) {
    for (const line of fs.readFileSync(vars, 'utf8').split(/\r?\n/)) {
      const match = /^\s*TELEGRAM_BOT_TOKEN\s*=\s*(.+?)\s*$/.exec(line);
      if (match) return match[1].replace(/^["']|["']$/g, '');
    }
  }
  return undefined;
}

const initData = process.argv[2];
const token = readToken(process.argv[3]);

if (!initData || !token) {
  console.error('Как пользоваться: node scripts/check-init-data.mjs "<initData>" [токен]');
  process.exit(1);
}

const params = new URLSearchParams(initData);
const hash = params.get('hash');
if (!hash) {
  console.error('В строке нет поля hash — это не initData.');
  process.exit(1);
}

const pairs = [];
for (const [key, value] of params) {
  if (key === 'hash' || key === 'signature') continue;
  pairs.push([key, value]);
}
pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const checkString = pairs.map(([key, value]) => `${key}=${value}`).join('\n');

const secret = createHmac('sha256', 'WebAppData').update(token).digest();
const expected = createHmac('sha256', secret).update(checkString).digest('hex');

console.log(`бот из токена: ${token.split(':')[0]}`);
console.log(`поля подписи:  ${pairs.map(([key]) => key).join(', ')}`);

const authDate = Number(params.get('auth_date'));
if (Number.isFinite(authDate)) {
  const age = Math.round(Date.now() / 1000 - authDate);
  console.log(`возраст:       ${age} с (${new Date(authDate * 1000).toLocaleString()})`);
}

if (expected === hash.toLowerCase()) {
  console.log('\nПодпись сходится. Токен и мини-приложение принадлежат одному боту.');
  process.exit(0);
}

console.log(`\nПодпись НЕ сходится.`);
console.log(`  ожидалось: ${expected}`);
console.log(`  пришло:    ${hash.toLowerCase()}`);
console.log('\nЗначит, initData подписан другим ботом, а не тем, чей это токен.');
process.exit(1);
