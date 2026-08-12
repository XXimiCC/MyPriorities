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

export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  if (!origin) return {};

  const allowed = env.ALLOWED_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!allowed.includes(origin)) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    /*
     * X-Devkit-Invite здесь есть, а X-Devkit-Token — нет, и это не описка.
     * Первый живёт в ссылке тестировщика и по определению приезжает из
     * браузера. Второй — ключ командной строки; разрешить его здесь значило бы
     * пригласить браузер его прислать.
     */
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Devkit-Invite',
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
