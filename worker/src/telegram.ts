/**
 * Проверка подписи мини-аппа и отправка сообщений ботом.
 *
 * Telegram кладёт в `initData` строку запроса с полями пользователя и подписью
 * `hash`. Подпись считается так: из всех полей, кроме самого `hash`, собирается
 * строка `ключ=значение`, отсортированная по ключу и склеенная переводами
 * строки; ключ подписи — HMAC-SHA256 от токена бота с ключом-константой
 * `WebAppData`.
 *
 * Начиная с Bot API 8.0 есть и второй путь — Ed25519-подпись в поле `signature`,
 * которую можно проверить без токена бота. Он здесь не нужен: токен у Worker и
 * так есть, а лишний захардкоженный публичный ключ — это ещё одна вещь, которая
 * молча сломает вход, если Telegram его сменит.
 */

import { hmacSha256, timingSafeEqual, toHex, utf8 } from './crypto';

/** Сколько живёт подпись. Старую не принимаем: перехваченная строка иначе вечна. */
export const INIT_DATA_MAX_AGE_SECONDS = 300;

export interface TelegramUser {
  id: number;
  username?: string;
  firstName?: string;
}

export class InitDataError extends Error {
  /**
   * Что удалось разглядеть, не раскрывая секретов: имена полей и номер бота.
   *
   * Без этого «подпись не сошлась» — тупик: причин ровно две, чужой токен и
   * неверная строка проверки, и снаружи они выглядят одинаково. Имена полей не
   * тайна, номер бота тоже — тайна только то, что после двоеточия.
   */
  constructor(
    readonly code: string,
    readonly hint?: string,
  ) {
    super(code);
    this.name = 'InitDataError';
  }
}

/**
 * Разбирает и проверяет `initData`. Возвращает пользователя либо бросает.
 *
 * `now` приходит аргументом, а не берётся из Date.now(): иначе проверку срока
 * не написать.
 */
/** Форма токена от BotFather: номер бота, двоеточие, секрет. */
const TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]+$/;

export async function verifyInitData(
  initData: string,
  rawToken: string,
  now: number = Date.now(),
): Promise<TelegramUser> {
  if (typeof initData !== 'string' || initData.length === 0) {
    throw new InitDataError('empty');
  }

  /*
   * Пробелы по краям срезаются.
   *
   * Токен попадает в секрет копированием, и лишний перевод строки в конце —
   * самая частая беда при настройке: бот тот, байты другие, подпись не сходится,
   * а понять это по ответу невозможно. Ключ считается от токена целиком, так что
   * один невидимый символ меняет всё.
   */
  const botToken = rawToken.trim();

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new InitDataError('no-hash');

  /*
   * В строку проверки идут все поля, кроме hash и signature. Signature
   * исключается по требованию Telegram: он появился позже и в исходный расчёт
   * hash не входит, так что оставить его — значит не сойтись подписью на новых
   * клиентах.
   */
  const pairs: string[] = [];
  for (const [key, value] of params) {
    if (key === 'hash' || key === 'signature') continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const checkString = pairs.join('\n');

  const secret = await hmacSha256(utf8('WebAppData'), botToken);
  const expected = toHex(await hmacSha256(secret, checkString));
  if (!timingSafeEqual(expected, hash.toLowerCase())) {
    const botId = botToken.split(':')[0] ?? '?';
    const keys = pairs.map((pair) => pair.slice(0, pair.indexOf('='))).join(',');
    // Форма токена в подсказку: кривой токен и чужой токен снаружи выглядят
    // одинаково, а чинятся по-разному.
    const shape = TOKEN_PATTERN.test(botToken)
      ? `${botToken.length} симв.`
      : `ФОРМА ТОКЕНА НЕВЕРНА, ${botToken.length} симв.`;
    throw new InitDataError('bad-signature', `бот ${botId} (${shape}), поля: ${keys}`);
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) throw new InitDataError('no-auth-date');
  const age = Math.floor(now / 1000) - authDate;
  // Отрицательный возраст — часы клиента ушли вперёд; это не подделка, но и
  // доверять такому сроку нельзя, поэтому допускаем только небольшой запас.
  if (age > INIT_DATA_MAX_AGE_SECONDS || age < -INIT_DATA_MAX_AGE_SECONDS) {
    throw new InitDataError('expired');
  }

  const rawUser = params.get('user');
  if (!rawUser) throw new InitDataError('no-user');
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawUser);
  } catch {
    throw new InitDataError('bad-user');
  }

  const user = parsed as { id?: unknown; username?: unknown; first_name?: unknown };
  const id = Number(user.id);
  if (!Number.isFinite(id) || id <= 0) throw new InitDataError('bad-user');

  return {
    id: Math.trunc(id),
    ...(typeof user.username === 'string' ? { username: user.username } : {}),
    ...(typeof user.first_name === 'string' ? { firstName: user.first_name } : {}),
  };
}

/**
 * Сообщение от бота. Используется только ночным отчётом, поэтому отказ здесь
 * ничего не роняет: не доставленный отчёт — потеря наблюдения, а не данных.
 */
export async function sendMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
