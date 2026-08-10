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

/**
 * Сколько живёт подпись.
 *
 * Сутки, а не минуты, и это не послабление, а исправление ошибки. `auth_date`
 * проставляется в момент ЗАПУСКА мини-аппа, а не запроса, и дальше не меняется
 * весь сеанс. Telegram Desktop держит вебвью живым часами; при пятиминутном
 * окне человек, вернувшийся к открытому приложению, войти уже не мог.
 *
 * Срок здесь защищает только от повторного использования утёкшей строки —
 * подлинность даёт подпись. А утечь ей особо неоткуда: она уходит по HTTPS
 * прямо сюда и нигде не оседает. К тому же нужна она один раз на устройство:
 * дальше живут свои токены с их собственным продлением.
 */
export const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

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

/**
 * Когда подпись не сошлась, спрашиваем не «почему», а «а как бы сошлась».
 *
 * Причин расхождения ровно две: не тот ключ или не так собранная строка
 * проверки. Различить их снаружи нельзя, а гадать дорого — поэтому перебираем
 * несколько заведомо возможных прочтений и сообщаем, какое подошло. Название
 * прочтения и есть диагноз; данные пользователя при этом никуда не попадают.
 */
async function whichReadingMatches(
  initData: string,
  botToken: string,
  hash: string,
): Promise<string | undefined> {
  // Пары как есть, без раскодирования: вдруг Telegram считает подпись по ним.
  const rawPairs: string[] = [];
  // Раскодирование через decodeURIComponent: оно, в отличие от URLSearchParams,
  // не превращает «+» в пробел.
  const uriPairs: string[] = [];
  for (const chunk of initData.split('&')) {
    const eq = chunk.indexOf('=');
    if (eq < 0) continue;
    const key = chunk.slice(0, eq);
    if (key === 'hash' || key === 'signature') continue;
    rawPairs.push(chunk);
    try {
      uriPairs.push(`${key}=${decodeURIComponent(chunk.slice(eq + 1))}`);
    } catch {
      uriPairs.push(chunk);
    }
  }
  rawPairs.sort();
  uriPairs.sort();

  // То же, что сейчас, но БЕЗ signature. Однажды я так и делал, и это стоило
  // долгих поисков; пусть проверка сама скажет, если маятник качнётся обратно.
  const withoutSignature: string[] = [];
  for (const [key, value] of new URLSearchParams(initData)) {
    if (key !== 'hash' && key !== 'signature') withoutSignature.push(`${key}=${value}`);
  }
  withoutSignature.sort();

  const webApp = await hmacSha256(utf8('WebAppData'), botToken);
  // Ключ по правилам виджета входа на сайт: SHA-256 от токена, а не HMAC.
  const widget = new Uint8Array(
    await crypto.subtle.digest('SHA-256', utf8(botToken) as unknown as ArrayBuffer),
  );

  const attempts: Array<[string, Uint8Array, string]> = [
    ['значения без раскодирования', webApp, rawPairs.join('\n')],
    ['decodeURIComponent вместо URLSearchParams', webApp, uriPairs.join('\n')],
    ['без поля signature в строке', webApp, withoutSignature.join('\n')],
    ['ключ виджета входа (SHA-256 токена)', widget, rawPairs.join('\n')],
  ];

  for (const [name, key, message] of attempts) {
    if (timingSafeEqual(toHex(await hmacSha256(key, message)), hash)) return name;
  }
  return undefined;
}

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
   * В строку проверки идут ВСЕ поля, кроме самого hash. В том числе signature.
   *
   * Здесь легко ошибиться, и я ошибся: у Telegram две разные проверки, и они
   * исключают разное. Ed25519-проверка по полю `signature` — та, что позволяет
   * обойтись без токена бота, — исключает и `hash`, и `signature`. А вот
   * HMAC-проверка по `hash`, которая здесь, исключает только `hash`: signature
   * для неё обычное поле, пришедшее вместе с остальными.
   *
   * Перепутать их означает не сходиться подписью ровно на тех клиентах, что
   * присылают signature, то есть на всех новых. Снаружи это выглядит как «не
   * тот токен», и ищется очень долго.
   */
  const pairs: string[] = [];
  for (const [key, value] of params) {
    if (key === 'hash') continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const checkString = pairs.join('\n');

  const secret = await hmacSha256(utf8('WebAppData'), botToken);
  const expected = toHex(await hmacSha256(secret, checkString));
  if (!timingSafeEqual(expected, hash.toLowerCase())) {
    const botId = botToken.split(':')[0] ?? '?';
    const keys = pairs.map((pair) => pair.slice(0, pair.indexOf('='))).join(',');
    const shape = TOKEN_PATTERN.test(botToken)
      ? `${botToken.length} симв.`
      : `ФОРМА ТОКЕНА НЕВЕРНА, ${botToken.length} симв.`;

    const other = await whichReadingMatches(initData, botToken, hash.toLowerCase());
    throw new InitDataError(
      'bad-signature',
      `бот ${botId} (${shape}), поля: ${keys}${other ? `, СОШЛОСЬ ПРОЧТЕНИЕ: ${other}` : ''}`,
    );
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
