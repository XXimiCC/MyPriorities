/**
 * Вход через Telegram вне Telegram.
 *
 * Внутри мини-аппа подпись приходит сама и проверяется токеном бота. В обычном
 * браузере так нельзя: там человек возвращается с кодом, который надо обменять
 * на `id_token` — подписанный самим Telegram JWT, — и проверить его открытым
 * ключом из JWKS.
 *
 * Обмен делает Worker, а не браузер, потому что для него нужен клиентский
 * секрет. Браузер приносит только код и свой `code_verifier`: без PKCE
 * перехваченный код можно было бы обменять кому угодно.
 */

import { base64url, fromBase64url } from './crypto';

const ISSUER = 'https://oauth.telegram.org';
const TOKEN_URL = `${ISSUER}/token`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;

/** Запас на расхождение часов. Меньше — и вход ломался бы у людей с неточным временем. */
const CLOCK_SKEW_SECONDS = 120;

export class OidcError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OidcError';
  }
}

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

/**
 * Кэш ключей в памяти изолята.
 *
 * Час — не догма, а компромисс: ключи меняются редко, а ходить за ними на
 * каждый вход значит добавлять к нему чужую доступность. Незнакомый `kid`
 * обновляет кэш немедленно, минуя срок, — иначе смена ключа ломала бы вход на
 * целый час.
 */
const JWKS_TTL_MS = 60 * 60 * 1000;
let cached: { keys: Jwk[]; at: number } | undefined;

async function fetchJwks(): Promise<Jwk[]> {
  const response = await fetch(JWKS_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new OidcError('jwks-unavailable');
  const body = (await response.json()) as { keys?: unknown };
  if (!Array.isArray(body.keys)) throw new OidcError('jwks-malformed');
  return body.keys as Jwk[];
}

async function keyFor(kid: string | undefined): Promise<Jwk> {
  const find = (keys: Jwk[]): Jwk | undefined =>
    kid ? keys.find((key) => key.kid === kid) : keys[0];

  if (cached && Date.now() - cached.at < JWKS_TTL_MS) {
    const hit = find(cached.keys);
    if (hit) return hit;
  }

  cached = { keys: await fetchJwks(), at: Date.now() };
  const key = find(cached.keys);
  if (!key) throw new OidcError('unknown-key');
  return key;
}

export interface IdTokenClaims {
  /** Идентификатор пользователя Telegram, строкой. */
  sub: string;
  username?: string;
}

function decodeJson(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(fromBase64url(part))) as Record<string, unknown>;
}

/**
 * Проверка подписи и содержимого. Строгая намеренно: `id_token` — это
 * утверждение «я такой-то», и единственное, что отделяет его от подделки, —
 * подпись, издатель, адресат и срок.
 */
export async function verifyIdToken(
  token: string,
  clientId: string,
  now: number = Date.now(),
): Promise<IdTokenClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new OidcError('malformed');
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeJson(rawHeader);
    payload = decodeJson(rawPayload);
  } catch {
    throw new OidcError('malformed');
  }

  // Алгоритм сверяется до всего остального: «alg: none» и подмена на HMAC
  // ключом, взятым из JWKS, — классические способы обойти проверку подписи.
  if (header.alg !== 'RS256') throw new OidcError('bad-alg');

  const jwk = await keyFor(typeof header.kid === 'string' ? header.kid : undefined);
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) throw new OidcError('bad-key');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signed = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
  const signature = fromBase64url(rawSignature);
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature as unknown as ArrayBuffer,
    signed as unknown as ArrayBuffer,
  );
  if (!ok) throw new OidcError('bad-signature');

  if (payload.iss !== ISSUER) throw new OidcError('bad-issuer');

  // Адресат бывает строкой или списком: спецификация допускает оба.
  const audience = Array.isArray(payload.aud) ? payload.aud.map(String) : [String(payload.aud)];
  if (!audience.includes(clientId)) throw new OidcError('bad-audience');

  const seconds = Math.floor(now / 1000);
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp + CLOCK_SKEW_SECONDS < seconds) throw new OidcError('expired');
  const iat = Number(payload.iat);
  if (Number.isFinite(iat) && iat - CLOCK_SKEW_SECONDS > seconds) throw new OidcError('from-future');

  const sub = payload.sub;
  if (typeof sub !== 'string' && typeof sub !== 'number') throw new OidcError('no-subject');

  return {
    sub: String(sub),
    ...(typeof payload.username === 'string' ? { username: payload.username } : {}),
  };
}

/**
 * Обмен кода на токены.
 *
 * `code_verifier` приходит от браузера и уходит сюда же: код без него
 * бесполезен, поэтому перехваченный по дороге обменять не выйдет.
 */
export async function exchangeCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    client_id: clientId,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${base64url(`${clientId}:${clientSecret}`)
        .replace(/-/g, '+')
        .replace(/_/g, '/')}`,
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    id_token?: unknown;
    error?: unknown;
  };
  if (!response.ok) {
    console.warn(`[oidc] обмен кода отклонён: ${String(payload.error ?? response.status)}`);
    throw new OidcError('exchange-failed');
  }
  if (typeof payload.id_token !== 'string') throw new OidcError('no-id-token');
  return payload.id_token;
}
