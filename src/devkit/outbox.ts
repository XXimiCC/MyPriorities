/**
 * Очередь черновиков: тикет, собранный без сети, не теряется.
 *
 * Своя база IndexedDB, а не хранилище приложения. Причин три, и каждая
 * достаточна сама по себе: у чужой базы свой номер версии и своя лестница
 * обновления, и второй писатель в ней подрался бы за неё со стартом
 * приложения; блобам по четыреста килобайт нечего делать среди
 * пользовательских данных; и «сбросить всё» не должно решать судьбу
 * неотправленного отчёта об ошибке.
 *
 * localStorage не подходит вовсе: четыреста килобайт превращаются в base64 в
 * пятьсот пятьдесят, пишутся синхронно и делят с приложением общие пять
 * мегабайт — ровно та беда, ради ухода от которой в проекте вообще появилась
 * IndexedDB.
 *
 * Дескриптор базы открывается лениво, внутри функции: модуль обязан
 * импортироваться в node без браузера.
 */

import { currentHost } from './host';
import { markPending } from './pending';
import type { TicketPayload } from './types';

const DB_NAME = 'mypri-devkit';
const DB_VERSION = 1;
const STORE = 'outbox';

/** Инструмент отладки не имеет права стать причиной, по которой на телефоне кончилось место. */
export const MAX_DRAFTS = 5;
export const MAX_TOTAL_BYTES = 3_000_000;
export const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Сколько раз пробовать, прежде чем признать отчёт безнадёжным. */
export const MAX_TRIES = 6;

/** Отступы между попытками. Дальше последнего — по последнему. */
const BACKOFF = [0, 60_000, 300_000, 1_800_000];

export interface Draft {
  id: string;
  createdAt: number;
  ticket: TicketPayload;
  shot?: Blob;
  tries: number;
  nextAt: number;
  lastError?: string;
}

export function nextAttemptAt(tries: number, now: number): number {
  const step = BACKOFF[Math.min(tries, BACKOFF.length - 1)] ?? 0;
  return now + step;
}

export function expired(draft: Draft, now: number): boolean {
  return now - draft.createdAt > TTL_MS;
}

/**
 * Кого выселить, чтобы влез новый черновик. Старые уходят первыми: свежая
 * жалоба почти всегда актуальнее недельной.
 */
export function evictFor(drafts: Draft[], incomingBytes: number): string[] {
  const sorted = [...drafts].sort((a, b) => a.createdAt - b.createdAt);
  const doomed: string[] = [];

  let count = sorted.length + 1;
  let bytes = sorted.reduce((sum, draft) => sum + (draft.shot?.size ?? 0), 0) + incomingBytes;

  for (const draft of sorted) {
    if (count <= MAX_DRAFTS && bytes <= MAX_TOTAL_BYTES) break;
    doomed.push(draft.id);
    count -= 1;
    bytes -= draft.shot?.size ?? 0;
  }

  return doomed;
}

interface Store {
  all(): Promise<Draft[]>;
  put(draft: Draft): Promise<void>;
  drop(id: string): Promise<void>;
}

function memoryStore(): Store {
  const kept = new Map<string, Draft>();
  return {
    all: () => Promise.resolve([...kept.values()]),
    put: (draft) => {
      kept.set(draft.id, draft);
      return Promise.resolve();
    },
    drop: (id) => {
      kept.delete(id);
      return Promise.resolve();
    },
  };
}

function request<T>(query: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    query.onsuccess = () => resolve(query.result);
    query.onerror = () => reject(query.error ?? new Error('IndexedDB отказал'));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('база панели не открылась'));
  });
}

function indexedStore(db: IDBDatabase): Store {
  const tx = (mode: IDBTransactionMode): IDBObjectStore => db.transaction(STORE, mode).objectStore(STORE);
  return {
    all: () => request(tx('readonly').getAll() as IDBRequest<Draft[]>),
    put: async (draft) => {
      await request(tx('readwrite').put(draft));
    },
    drop: async (id) => {
      await request(tx('readwrite').delete(id));
    },
  };
}

let store: Promise<Store> | undefined;

function backend(): Promise<Store> {
  if (store) return store;
  store = (async () => {
    // Демо не оставляет следов на устройстве, и очередь — не исключение.
    if (currentHost()?.ephemeral || typeof indexedDB === 'undefined') return memoryStore();
    try {
      return indexedStore(await openDb());
    } catch (error) {
      // Приватный режим, переполненный диск, запрет хранилища. Черновик
      // доживёт до конца сеанса в памяти — это лучше, чем не собрать его вовсе.
      console.warn('[devkit] очередь только в памяти', error);
      return memoryStore();
    }
  })();
  return store;
}

export async function keepDraft(draft: Draft): Promise<void> {
  const backing = await backend();
  const drafts = await backing.all();
  for (const id of evictFor(drafts, draft.shot?.size ?? 0)) await backing.drop(id);
  await backing.put(draft);
  markPending(true);
}

export async function dropDraft(id: string): Promise<void> {
  const backing = await backend();
  await backing.drop(id);
  if ((await backing.all()).length === 0) markPending(false);
}

/** Черновики, которым пора: протухшие по дороге выбрасываются. */
export async function dueDrafts(now: number): Promise<Draft[]> {
  const backing = await backend();
  const due: Draft[] = [];

  for (const draft of await backing.all()) {
    if (expired(draft, now)) {
      await backing.drop(draft.id);
      continue;
    }
    if (draft.nextAt <= now) due.push(draft);
  }

  return due.sort((a, b) => a.createdAt - b.createdAt);
}

/** Отложить следующую попытку либо признать отчёт безнадёжным. */
export async function delayDraft(draft: Draft, now: number, reason: string): Promise<void> {
  const tries = draft.tries + 1;
  if (tries >= MAX_TRIES) {
    console.warn('[devkit] тикет так и не ушёл', reason);
    await dropDraft(draft.id);
    return;
  }
  await (await backend()).put({ ...draft, tries, nextAt: nextAttemptAt(tries, now), lastError: reason });
}

/** Только для тестов: подменить хранилище и сбросить выбранный движок. */
export function resetOutboxForTests(replacement?: Store): void {
  store = replacement ? Promise.resolve(replacement) : undefined;
}

export { memoryStore as memoryOutboxForTests };
export type { Store as OutboxStore };
