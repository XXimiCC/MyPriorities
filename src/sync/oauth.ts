/**
 * Вход через Telegram в обычном браузере.
 *
 * Внутри мини-аппа вход молчаливый — подпись приходит сама. Снаружи человек
 * уходит на страницу Telegram и возвращается с кодом, который обменивает на
 * сессию уже сервер: для обмена нужен клиентский секрет, а в браузере его быть
 * не должно.
 *
 * PKCE обязателен. Без него перехваченный код обменял бы кто угодно: он летит
 * в адресной строке, попадает в историю браузера и в журналы прокси. С PKCE
 * код бесполезен без `code_verifier`, который никуда, кроме нашего сервера,
 * не уходит.
 *
 * Возврат идёт на корень приложения, а не на отдельный путь. Сборка ссылается
 * на свои файлы относительными путями, и `index.html`, отданный по адресу
 * `/auth/callback`, искал бы их в `/auth/assets/…`.
 */

const AUTH_URL = 'https://oauth.telegram.org/auth';

/** Переживает уход на чужую страницу и возврат, но не переживает вкладку. */
const VERIFIER_KEY = 'mypri:pkce';
const STATE_KEY = 'mypri:state';

function randomString(bytes = 32): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  let binary = '';
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const CLIENT_ID = (import.meta.env?.VITE_TELEGRAM_CLIENT_ID as string | undefined) ?? '';

/** Адрес возврата. Ровно он же должен быть разрешён у бота в BotFather. */
export function redirectUri(): string {
  return `${window.location.origin}/`;
}

export function loginAvailable(): boolean {
  return Boolean(CLIENT_ID) && typeof crypto?.subtle?.digest === 'function';
}

/** Уводит на страницу Telegram. Возврата из этой функции не бывает. */
export async function startLogin(): Promise<void> {
  if (!loginAvailable()) throw new Error('вход не настроен');

  const verifier = randomString();
  const state = randomString(16);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', await challengeFor(verifier));
  url.searchParams.set('code_challenge_method', 'S256');

  window.location.assign(url.toString());
}

export interface Callback {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

/**
 * Разбирает возврат из Telegram, если он есть.
 *
 * Адресная строка чистится всегда — и при успехе, и при отказе. Код одноразовый,
 * а оставленный в строке он попадёт в закладку, в историю и в чужой скриншот.
 */
export function takeCallback(): Callback | undefined {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');

  if (!code && !error) return undefined;

  const expected = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  window.history.replaceState(null, '', window.location.pathname);

  if (error) {
    console.warn(`[oauth] Telegram отказал: ${error}`);
    return undefined;
  }
  /*
   * Несовпавший state — признак того, что возврат затеяли не мы. Так работает
   * защита от подсовывания чужого кода: без неё в аккаунт человека можно было
   * бы войти под собой, отправив ему ссылку.
   */
  if (!state || !expected || state !== expected) {
    console.warn('[oauth] state не совпал, вход отклонён');
    return undefined;
  }
  if (!verifier) {
    console.warn('[oauth] потерян code_verifier, вход отклонён');
    return undefined;
  }

  return { code: code!, codeVerifier: verifier, redirectUri: redirectUri() };
}
