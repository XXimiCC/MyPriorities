/**
 * Криптографические мелочи поверх Web Crypto.
 *
 * Своей математики здесь нет и быть не должно — только обвязка: кодирование,
 * подпись, сравнение. Всё содержательное делает `crypto.subtle`, который в
 * Workers есть из коробки.
 */

const encoder = new TextEncoder();

export function utf8(value: string): Uint8Array {
  return encoder.encode(value);
}

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (const byte of view) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function base64url(bytes: ArrayBuffer | Uint8Array | string): string {
  const view =
    typeof bytes === 'string'
      ? utf8(bytes)
      : bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacKey(secret: ArrayBuffer | Uint8Array): Promise<CryptoKey> {
  const raw = secret instanceof Uint8Array ? secret : new Uint8Array(secret);
  return crypto.subtle.importKey(
    'raw',
    raw as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

export async function hmacSha256(
  secret: ArrayBuffer | Uint8Array | string,
  message: string,
): Promise<Uint8Array> {
  const key = await hmacKey(typeof secret === 'string' ? utf8(secret) : secret);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(message)));
}

export async function sha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', utf8(value) as unknown as ArrayBuffer));
}

/**
 * Сравнение за постоянное время.
 *
 * Обычное `===` на строках выходит из цикла на первом различии, и по времени
 * ответа подпись можно подобрать посимвольно. Разную длину раскрываем сразу:
 * её не скрыть всё равно, а притворяться — только усложнять.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function randomToken(bytes = 32): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return base64url(raw);
}

export function randomUuid(): string {
  return crypto.randomUUID();
}
