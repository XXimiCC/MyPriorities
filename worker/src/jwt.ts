/**
 * Токены доступа.
 *
 * Свой JWT на HS256, а не чужая библиотека: нужны ровно две операции —
 * подписать и проверить, — а подписывающая и проверяющая стороны здесь одна и
 * та же, так что разбирать чужие ключи не приходится.
 *
 * Access живёт четверть часа и в базу не ходит: проверка — это подпись и срок.
 * Долгий refresh лежит в `sessions` хешем, и всё, что связано с отзывом,
 * происходит там.
 */

import { base64url, fromBase64url, hmacSha256, timingSafeEqual, toHex } from './crypto';

export const ACCESS_TTL_SECONDS = 15 * 60;

export interface AccessClaims {
  /** Наш идентификатор пользователя. */
  sub: string;
  /** Устройство: нужно, чтобы отличать курсоры и гасить одну цепочку сессий. */
  dev: string;
  exp: number;
  iat: number;
}

const HEADER = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

export async function signAccess(
  secret: string,
  userId: string,
  deviceId: string,
  now: number = Date.now(),
): Promise<string> {
  const issued = Math.floor(now / 1000);
  const claims: AccessClaims = {
    sub: userId,
    dev: deviceId,
    iat: issued,
    exp: issued + ACCESS_TTL_SECONDS,
  };
  const payload = base64url(JSON.stringify(claims));
  const signature = toHex(await hmacSha256(secret, `${HEADER}.${payload}`));
  return `${HEADER}.${payload}.${signature}`;
}

/** Разбор и проверка. undefined — токен не наш, испорчен или просрочен. */
export async function verifyAccess(
  secret: string,
  token: string,
  now: number = Date.now(),
): Promise<AccessClaims | undefined> {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const [header, payload, signature] = parts as [string, string, string];

  // Заголовок сверяется целиком, а не разбирается: так «alg: none» и подмена
  // алгоритма невозможны в принципе, а не отсекаются проверкой поля.
  if (header !== HEADER) return undefined;

  const expected = toHex(await hmacSha256(secret, `${header}.${payload}`));
  if (!timingSafeEqual(expected, signature)) return undefined;

  let claims: AccessClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as AccessClaims;
  } catch {
    return undefined;
  }

  if (typeof claims.sub !== 'string' || !claims.sub) return undefined;
  if (typeof claims.dev !== 'string' || !claims.dev) return undefined;
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= now) return undefined;
  return claims;
}
