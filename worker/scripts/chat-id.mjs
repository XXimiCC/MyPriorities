/*
 * Показывает chat id для ночного отчёта.
 *
 * Идентификатор чата нельзя вывести ни из ссылки-приглашения, ни из имени: его
 * знает только Telegram и отдаёт лишь вместе с настоящим сообщением. Поэтому
 * порядок такой — сначала написать боту, потом спросить у Telegram, что он
 * видел.
 *
 * Токен читается из .dev.vars и никуда, кроме api.telegram.org, не уходит.
 *
 *   npm run chat-id                      — показать, что бот видел
 *   npm run chat-id -- --send <chat_id>  — проверить id отправкой
 *
 * Проверка отправкой не роскошь: у ботов нет способа узнать, состоит ли он в
 * чате, кроме как попробовать написать. Неверный id в секрете иначе всплыл бы
 * ночью — молчанием, которое не отличить от «всё в порядке».
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VARS = path.join(HERE, '..', '.dev.vars');

function readToken() {
  const fromEnv = process.env.TELEGRAM_BOT_TOKEN;
  if (fromEnv) return fromEnv.trim();

  if (!fs.existsSync(VARS)) {
    console.error('Нет worker/.dev.vars. Скопируйте .dev.vars.example и впишите токен бота.');
    process.exit(1);
  }
  for (const line of fs.readFileSync(VARS, 'utf8').split(/\r?\n/)) {
    const match = /^\s*TELEGRAM_BOT_TOKEN\s*=\s*(.+?)\s*$/.exec(line);
    if (match) return match[1].replace(/^["']|["']$/g, '');
  }
  console.error('В worker/.dev.vars нет TELEGRAM_BOT_TOKEN.');
  process.exit(1);
}

const token = readToken();
if (token.includes('replace-me') || token === '123456:AAHtesttokenvalue') {
  console.error('В .dev.vars лежит значение из примера, а не настоящий токен бота.');
  process.exit(1);
}

const api = async (method, params = {}) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
};

const me = await api('getMe');
if (!me.ok) {
  console.error(`Telegram не принял токен: ${me.description ?? 'неизвестно'}`);
  process.exit(1);
}
// Номер печатается рядом с именем: именно его показывает журнал Worker, и без
// него сверить «тот ли это бот» не с чем.
console.log(`Бот: @${me.result.username}, номер ${me.result.id}\n`);

const sendIndex = process.argv.indexOf('--send');
if (sendIndex >= 0) {
  const target = process.argv[sendIndex + 1];
  if (!target) {
    console.error('Укажите чат: npm run chat-id -- --send -1001234567890');
    process.exit(1);
  }

  const sent = await api('sendMessage', {
    chat_id: target,
    text: '<b>MyPriorities</b>\n\nПроверка связи. Сюда будет приходить ночной отчёт.',
    parse_mode: 'HTML',
  });

  if (sent.ok) {
    const chat = sent.result.chat;
    console.log(`Дошло: ${chat.type} «${chat.title ?? chat.first_name ?? ''}», id ${chat.id}`);
    if (String(chat.id) !== String(target)) {
      // Обычную группу Telegram при повышении до супергруппы переселяет, и
      // старый id продолжает работать, но в секрет надо класть новый.
      console.log(`Внимание: Telegram ответил другим id — ${chat.id}. В секрет кладите его.`);
    }
    process.exit(0);
  }

  console.error(`Не дошло: ${sent.description ?? 'неизвестно'}`);
  if (sent.error_code === 400) console.error('Скорее всего, id неверный или бота нет в этом чате.');
  if (sent.error_code === 403) console.error('Бота заблокировали или выгнали из чата.');
  process.exit(1);
}

/*
 * getUpdates и вебхук взаимно исключают друг друга: пока вебхук установлен,
 * обновления уходят туда и здесь список всегда будет пуст. Проверяем прямо,
 * иначе пустой ответ выглядел бы как «бот ничего не видел».
 */
const hook = await api('getWebhookInfo');
if (hook.ok && hook.result.url) {
  console.error(`У бота установлен вебхук (${hook.result.url}).`);
  console.error('Пока он стоит, getUpdates всегда пуст. Снимите его или возьмите id из логов вебхука.');
  process.exit(1);
}

const updates = await api('getUpdates', { limit: 100, allowed_updates: [] });
if (!updates.ok) {
  console.error(`Ошибка: ${updates.description}`);
  process.exit(1);
}

const chats = new Map();
for (const update of updates.result) {
  const message =
    update.message ??
    update.edited_message ??
    update.channel_post ??
    update.my_chat_member ??
    update.chat_member;
  const chat = message?.chat;
  if (chat && !chats.has(chat.id)) chats.set(chat.id, chat);
}

if (chats.size === 0) {
  console.log('Telegram пока ничего не показал. Дальше зависит от того, куда слать отчёт.\n');
  console.log('Себе в личку — проще всего:');
  console.log(`  1. Откройте @${me.result.username} и нажмите «Начать» (или напишите любое слово).`);
  console.log('  2. Запустите эту команду снова.\n');
  console.log('В группу:');
  console.log('  1. Добавьте бота в группу.');
  console.log('  2. Напишите там /start — именно команду: у ботов по умолчанию');
  console.log('     включён режим приватности, и обычные сообщения они не видят.');
  console.log('  3. Запустите эту команду снова. Id группы отрицательный.');
  process.exit(1);
}

console.log('Найденные чаты:\n');
for (const chat of chats.values()) {
  const name = chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(' ');
  const handle = chat.username ? ` @${chat.username}` : '';
  console.log(`  ${String(chat.id).padEnd(16)} ${chat.type.padEnd(10)} ${name}${handle}`);
}
console.log('\nНужный id поставьте секретом:');
console.log('  npx wrangler secret put REPORT_CHAT_ID');
