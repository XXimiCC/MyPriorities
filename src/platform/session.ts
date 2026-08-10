/**
 * Где на этом устройстве лежит сессия.
 *
 * Отдельный модуль, потому что ответ у платформ разный. В браузере и внутри
 * Telegram это IndexedDB рядом с остальными данными. В Capacitor вебвью iOS
 * вычищает своё хранилище тем агрессивнее, чем реже открывают приложение, и
 * сессия обязана переехать в Keychain — там подменится только эта реализация,
 * а всё, что выше, останется как есть.
 *
 * Токены живут не вечно, и потеря сессии не потеря данных: приложение работает
 * из локальной копии, а внутри Telegram вход к тому же молчаливый.
 */

import { opsLog } from '../store/local/db';
import type { Session } from '../sync/transport';

const KEY = 'session';

export interface SessionStore {
  read(): Promise<Session | undefined>;
  write(session: Session): Promise<void>;
  clear(): Promise<void>;
}

function sanitize(raw: unknown): Session | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Partial<Session>;
  if (typeof value.access !== 'string' || !value.access) return undefined;
  if (typeof value.refresh !== 'string' || !value.refresh) return undefined;
  const expiresAt = Number(value.expiresAt);
  return {
    access: value.access,
    refresh: value.refresh,
    userId: typeof value.userId === 'string' ? value.userId : '',
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
  };
}

export const sessionStore: SessionStore = {
  async read() {
    try {
      return sanitize(await opsLog.meta(KEY));
    } catch (error) {
      console.warn('[sync] сессия не прочиталась', error);
      return undefined;
    }
  },

  async write(session) {
    try {
      await opsLog.setMeta(KEY, session);
    } catch (error) {
      // Не записалась — доживём до конца сеанса и войдём заново при следующем
      // запуске. Ронять из-за этого нечего.
      console.warn('[sync] сессия не записалась', error);
    }
  },

  async clear() {
    try {
      await opsLog.setMeta(KEY, undefined);
    } catch (error) {
      console.warn('[sync] сессия не стёрлась', error);
    }
  },
};
