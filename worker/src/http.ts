/**
 * Ответы и заголовки.
 *
 * Мини-апп открыт с одного домена, Worker живёт на другом, поэтому каждый
 * запрос — межсайтовый, и без CORS браузер его не выпустит. Список origin
 * задаётся явно: со звёздочкой браузер всё равно не пропустит запрос с
 * заголовком авторизации, зато дыру открыть можно.
 */

import type { Env } from './env';

const JSON_TYPE = 'application/json; charset=utf-8';

/** Своя машина: localhost и приватные сети. Только им доверяется ключ разработчика. */
export function isOwnMachine(origin: string): boolean {
  const host = origin.replace(/^https?:\/\//, '').split(':')[0]?.toLowerCase() ?? '';
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
  if (host.endsWith('.local') || host.endsWith('.localhost')) return true;
  if (host.startsWith('10.') || host.startsWith('192.168.')) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  if (!origin) return {};

  const allowed = env.ALLOWED_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!allowed.includes(origin)) return {};

  /*
   * X-Devkit-Invite разрешён всем: он живёт в ссылке тестировщика и по
   * определению приезжает из браузера.
   *
   * X-Devkit-Token — ключ командной строки, и с боевых доменов его нет в
   * списке намеренно: разрешить его там значило бы пригласить браузер его
   * прислать. Но со своей машины он нужен по-настоящему: войти через Telegram
   * на localhost невозможно, бот такого домена не знает, и без этого заголовка
   * панель на dev-сервере не могла отправить ничего — запрос не выходил из
   * браузера вовсе, а тикет молча уходил в очередь. Ровно так и терялись
   * отчёты.
   */
  const headers = ['Content-Type', 'Authorization', 'X-Devkit-Invite'];
  if (isOwnMachine(origin)) headers.push('X-Devkit-Token');

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': headers.join(', '),
    'Access-Control-Max-Age': '86400',
    // Один и тот же URL отвечает разными заголовками разным origin — без Vary
    // кэш отдал бы чужой ответ.
    Vary: 'Origin',
  };
}

export function json(body: unknown, init: ResponseInit = {}, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': JSON_TYPE, ...Object.fromEntries(new Headers(extra)) },
  });
}

/**
 * Ошибка для клиента.
 *
 * Наружу уходит код, а не подробности: «подпись не сошлась» и «пользователя нет»
 * должны выглядеть одинаково, иначе ответ становится оракулом для подбора.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** Для журнала Worker, наружу не уходит. */
    readonly detail?: string,
  ) {
    super(`${status} ${code}`);
    this.name = 'HttpError';
  }
}

export const badRequest = (code: string, detail?: string): HttpError =>
  new HttpError(400, code, detail);
export const unauthorized = (code: string, detail?: string): HttpError =>
  new HttpError(401, code, detail);

/** Разбор тела с ограничением размера: чужой запрос не должен съедать память. */
export async function readJson(request: Request, limit = 1_000_000): Promise<unknown> {
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(length) && length > limit) throw badRequest('too-large');

  const text = await request.text();
  if (text.length > limit) throw badRequest('too-large');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw badRequest('not-json');
  }
}
