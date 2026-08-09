/**
 * Жизненный цикл сессии.
 *
 * Внутри Telegram вход молчаливый: `initData` приходит от клиента сам, экрана
 * логина нет и не нужно. Снаружи Telegram входа пока нет вовсе — там появится
 * Telegram Login в браузере, и он ляжет сюда же второй веткой.
 *
 * Ни одна ошибка здесь не мешает работать: приложение живёт из локальной копии,
 * а синхронизация — это удобство поверх, а не условие запуска. Поэтому наружу
 * отдаётся состояние, а не исключение, и показывается оно строкой в настройках.
 */

import { sessionStore } from '../platform/session';
import { initData, platform } from '../telegram/sdk';
import { deviceId } from './device';
import { TransportError, sessionExpired, transport, type Session } from './transport';

export type SyncState =
  /** Адрес сервера не задан сборкой: приложение просто работает локально. */
  | { kind: 'off' }
  | { kind: 'working' }
  | { kind: 'signed-in'; userId: string }
  /** Войти нечем: мы вне Telegram, а другого пути пока нет. */
  | { kind: 'no-way-in' }
  /** Сеть не дала. Это не отказ, а «попробуем позже». */
  | { kind: 'offline' }
  | { kind: 'error'; code: string };

let current: SyncState = transport.configured ? { kind: 'working' } : { kind: 'off' };
const listeners = new Set<(state: SyncState) => void>();

function publish(next: SyncState): void {
  current = next;
  for (const listener of listeners) listener(next);
}

export function syncState(): SyncState {
  return current;
}

export function subscribeSync(listener: (state: SyncState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Идущая работа с сессией.
 *
 * Единственная на всё приложение: три запроса, одновременно обнаружившие
 * просроченный токен, устроили бы три ротации подряд, а вторая и третья
 * выглядели бы для сервера как повторное предъявление — то есть как кража,
 * и он погасил бы всю цепочку.
 */
let inFlight: Promise<Session | undefined> | undefined;

async function signInSilently(): Promise<Session | undefined> {
  if (!initData) {
    publish({ kind: 'no-way-in' });
    return undefined;
  }
  const session = await transport.login({ initData, deviceId: await deviceId(), platform });
  await sessionStore.write(session);
  publish({ kind: 'signed-in', userId: session.userId });
  return session;
}

async function resolve(): Promise<Session | undefined> {
  const stored = await sessionStore.read();

  if (stored && !sessionExpired(stored)) {
    publish({ kind: 'signed-in', userId: stored.userId });
    return stored;
  }

  if (stored) {
    try {
      const next = await transport.refresh(stored.refresh);
      await sessionStore.write(next);
      publish({ kind: 'signed-in', userId: next.userId });
      return next;
    } catch (error) {
      // Просроченный или отозванный refresh — не повод сдаваться: внутри
      // Telegram войти заново можно молча, человек ничего не заметит.
      if (!(error instanceof TransportError) || !error.needsLogin) throw error;
      await sessionStore.clear();
    }
  }

  return signInSilently();
}

/**
 * Действующая сессия либо undefined, если её сейчас нет.
 *
 * Вызывать можно сколько угодно и откуда угодно: работа всё равно одна.
 */
export function ensureSession(): Promise<Session | undefined> {
  if (!transport.configured) return Promise.resolve(undefined);

  inFlight ??= (async () => {
    publish({ kind: 'working' });
    try {
      return await resolve();
    } catch (error) {
      if (error instanceof TransportError && error.status === 0) {
        publish({ kind: 'offline' });
      } else {
        publish({ kind: 'error', code: error instanceof TransportError ? error.code : 'unknown' });
      }
      return undefined;
    } finally {
      inFlight = undefined;
    }
  })();

  return inFlight;
}

export async function signOut(): Promise<void> {
  const stored = await sessionStore.read();
  await sessionStore.clear();
  if (stored) await transport.logout(stored.refresh);
  publish(transport.configured ? { kind: 'no-way-in' } : { kind: 'off' });
}
