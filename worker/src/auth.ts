/**
 * Вход и продление сессии.
 *
 * Вход только через Telegram: внутри мини-аппа он молчаливый — `initData`
 * приходит от клиента сам, экрана логина нет вовсе. Появится вход в обычном
 * браузере (OAuth2 + PKCE) — он ляжет сюда же второй веткой и выдаст ту же
 * пару токенов тому же профилю.
 */

import { randomToken, randomUuid, sha256 } from './crypto';
import type { Env } from './env';
import { HttpError, badRequest, unauthorized } from './http';
import { signAccess } from './jwt';
import { InitDataError, verifyInitData } from './telegram';

const REFRESH_TTL_SECONDS = 90 * 24 * 60 * 60;

export interface Tokens {
  access: string;
  refresh: string;
  userId: string;
  expiresIn: number;
}

const DEVICE_PATTERN = /^[a-z0-9]{1,32}$/;

function requireDeviceId(raw: unknown): string {
  if (typeof raw !== 'string' || !DEVICE_PATTERN.test(raw)) throw badRequest('bad-device');
  return raw;
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/**
 * Выдаёт пару токенов и запоминает refresh хешем.
 *
 * Хешем, а не как есть: база с ворохом действующих ключей от чужих аккаунтов —
 * это совсем другая цена утечки.
 */
async function issue(
  env: Env,
  userId: string,
  deviceId: string,
  now: number,
): Promise<Tokens> {
  const refresh = randomToken();
  const access = await signAccess(env.JWT_SECRET, userId, deviceId, now);

  await env.DB.prepare(
    'insert into sessions (token_hash, user_id, device_id, expires_at) values (?, ?, ?, ?)',
  )
    .bind(await sha256(refresh), userId, deviceId, iso(Math.floor(now / 1000) + REFRESH_TTL_SECONDS))
    .run();

  return { access, refresh, userId, expiresIn: 15 * 60 };
}

/** Заводит профиль под Telegram-аккаунт или находит существующий. */
async function profileFor(
  env: Env,
  telegramId: number,
  username: string | undefined,
): Promise<string> {
  const existing = await env.DB.prepare('select user_id from profiles where telegram_id = ?')
    .bind(telegramId)
    .first<{ user_id: string }>();
  if (existing) {
    // Имя могло смениться — оно только для диагностики, но пусть будет свежим.
    if (username) {
      await env.DB.prepare('update profiles set username = ? where user_id = ?')
        .bind(username, existing.user_id)
        .run();
    }
    return existing.user_id;
  }

  const userId = randomUuid();
  await env.DB.prepare(
    'insert into profiles (user_id, telegram_id, username) values (?, ?, ?)',
  )
    .bind(userId, telegramId, username ?? null)
    .run();
  return userId;
}

async function touchDevice(
  env: Env,
  userId: string,
  deviceId: string,
  platform: string | undefined,
): Promise<void> {
  await env.DB.prepare(
    `insert into devices (user_id, device_id, platform, last_seen_at)
     values (?, ?, ?, datetime('now'))
     on conflict (user_id, device_id)
       do update set platform = excluded.platform, last_seen_at = excluded.last_seen_at`,
  )
    .bind(userId, deviceId, platform ?? null)
    .run();
}

export async function handleTelegramLogin(
  env: Env,
  body: unknown,
  now: number = Date.now(),
): Promise<Tokens> {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const deviceId = requireDeviceId(input.deviceId);
  const platform = typeof input.platform === 'string' ? input.platform.slice(0, 32) : undefined;

  let user;
  try {
    user = await verifyInitData(String(input.initData ?? ''), env.TELEGRAM_BOT_TOKEN, now);
  } catch (error) {
    // Наружу один код на все причины: «подпись не сошлась» и «срок вышел»,
    // различённые в ответе, превращают его в подсказку для подбора.
    const code = error instanceof InitDataError ? error.code : 'unknown';
    throw unauthorized('bad-init-data', code);
  }

  const userId = await profileFor(env, user.id, user.username);
  await touchDevice(env, userId, deviceId, platform);
  return issue(env, userId, deviceId, now);
}

export async function handleRefresh(
  env: Env,
  body: unknown,
  now: number = Date.now(),
): Promise<Tokens> {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const token = input.refresh;
  if (typeof token !== 'string' || !token) throw badRequest('no-refresh');

  const hash = await sha256(token);
  const row = await env.DB.prepare(
    'select user_id, device_id, expires_at, revoked from sessions where token_hash = ?',
  )
    .bind(hash)
    .first<{ user_id: string; device_id: string | null; expires_at: string; revoked: number }>();

  if (!row) throw unauthorized('unknown-refresh');

  /*
   * Уже потраченный refresh предъявлен снова.
   *
   * Либо его украли, либо клиент повторил запрос после обрыва. Отличить нельзя,
   * поэтому исходим из худшего и гасим всю цепочку устройства: цена ошибки
   * несимметрична. Внутри Telegram повторный вход молчаливый — initData под
   * рукой всегда, — так что для мини-аппа это почти бесплатно.
   */
  if (row.revoked) {
    await env.DB.prepare(
      'update sessions set revoked = 1 where user_id = ? and device_id is ?',
    )
      .bind(row.user_id, row.device_id)
      .run();
    throw unauthorized('refresh-reused');
  }

  if (Date.parse(row.expires_at) <= now) throw unauthorized('refresh-expired');

  await env.DB.prepare('update sessions set revoked = 1 where token_hash = ?').bind(hash).run();
  return issue(env, row.user_id, row.device_id ?? 'unknown', now);
}

export async function handleLogout(env: Env, body: unknown): Promise<void> {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof input.refresh !== 'string' || !input.refresh) throw badRequest('no-refresh');
  await env.DB.prepare('update sessions set revoked = 1 where token_hash = ?')
    .bind(await sha256(input.refresh))
    .run();
}

export { HttpError };
