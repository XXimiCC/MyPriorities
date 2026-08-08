/**
 * Локальная копия данных на устройстве.
 *
 * Раньше ею был `localStorage`, и этого хватало, пока над ним стоял
 * CloudStorage со своими 4096 байтами на ключ: копия физически не могла
 * оказаться больше оригинала. Дальше лимит уходит, объём растёт, и синхронный
 * `localStorage` перестаёт годиться — он держит всё в одной строковой квоте на
 * домен (обычно 5 МБ) и блокирует поток на каждой записи.
 *
 * Поэтому основное хранилище здесь — IndexedDB, а `localStorage` остаётся
 * запасным путём для сред, где IndexedDB нет: приватный режим отдельных
 * браузеров, вебвью с отключённым хранилищем. Третий уровень — память: она
 * бесполезна между запусками, но позволяет приложению открыться и работать
 * до конца сеанса вместо белого экрана.
 */

import type { KeyValueStore, ValuePair } from '../kv';
import { IdbUnavailable, openDb, req, txDone } from './idb';

const DB_NAME = 'mypri';
const DB_VERSION = 1;
/** Данные пользователя: ключи те же `mp:*`, что и в CloudStorage. */
const STORE_KV = 'kv';
/** Служебное: сюда не попадают ключи данных, поэтому `keys()` не приходится фильтровать. */
const STORE_META = 'meta';

/** Свой префикс, чтобы локальная копия не путалась с чужими ключами на том же домене. */
const LOCAL_PREFIX = 'mypri/';

/**
 * Отметка «данные уже переехали в IndexedDB» — лежит именно в `localStorage`,
 * а не в самой базе.
 *
 * Смысл в том, чтобы отличить два внешне одинаковых случая: базы нет, потому
 * что человек здесь впервые, и базы нет, потому что её не отдали. Во втором
 * содержимое `localStorage` устарело на всё время после переезда, и отдать его
 * наверх — это ровно та ошибка, от которой бережётся `loadFailed`: пустая или
 * старая память выглядит как «данных нет», и первая же запись затирает живое.
 */
const MIGRATED_MARK = `${LOCAL_PREFIX}__idb`;

// --- Запасные реализации -----------------------------------------------------

function pairsOf(values: Record<string, string>): Record<string, ValuePair> {
  const out: Record<string, ValuePair> = {};
  for (const [key, value] of Object.entries(values)) out[key] = { local: value };
  return out;
}

function hasWebStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    // Доступ к самому объекту бросает в приватном режиме Safari.
    return false;
  }
}

const webStorageStore: KeyValueStore = {
  kind: 'local',
  isDegraded: () => false,
  async get(keys) {
    const out: Record<string, string> = {};
    for (const key of keys) {
      const value = localStorage.getItem(LOCAL_PREFIX + key);
      if (value !== null) out[key] = value;
    }
    return out;
  },
  async getPair(keys) {
    return pairsOf(await webStorageStore.get(keys));
  },
  async set(key, value) {
    localStorage.setItem(LOCAL_PREFIX + key, value);
  },
  async remove(keys) {
    for (const key of keys) localStorage.removeItem(LOCAL_PREFIX + key);
  },
  async keys() {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const raw = localStorage.key(i);
      if (raw?.startsWith(LOCAL_PREFIX) && raw !== MIGRATED_MARK) {
        out.push(raw.slice(LOCAL_PREFIX.length));
      }
    }
    return out;
  },
};

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  const store: KeyValueStore = {
    kind: 'local',
    isDegraded: () => false,
    async get(keys) {
      const out: Record<string, string> = {};
      for (const key of keys) {
        const value = map.get(key);
        if (value !== undefined) out[key] = value;
      }
      return out;
    },
    async getPair(keys) {
      return pairsOf(await store.get(keys));
    },
    async set(key, value) {
      map.set(key, value);
    },
    async remove(keys) {
      for (const key of keys) map.delete(key);
    },
    async keys() {
      return [...map.keys()];
    },
  };
  return store;
}

/**
 * Хранилище, которое честно отказывает.
 *
 * Возвращается, когда данные точно есть, но добраться до них не вышло. Молчать
 * тут нельзя: успешное чтение пустоты снимает защиту `loadFailed`, и приложение
 * запишет пустой месяц поверх настоящего.
 */
function failingStore(reason: unknown): KeyValueStore {
  const fail = (): never => {
    throw new IdbUnavailable('данные уже переехали в базу, а она не открылась', { cause: reason });
  };
  return {
    kind: 'local',
    isDegraded: () => true,
    async get() {
      return fail();
    },
    async getPair() {
      return fail();
    },
    async set() {
      return fail();
    },
    async remove() {
      return fail();
    },
    async keys() {
      return fail();
    },
  };
}

// --- IndexedDB ---------------------------------------------------------------

function idbBacked(db: IDBDatabase): KeyValueStore {
  const store: KeyValueStore = {
    kind: 'local',
    isDegraded: () => false,

    async get(keys) {
      if (keys.length === 0) return {};
      const tx = db.transaction(STORE_KV, 'readonly');
      const os = tx.objectStore(STORE_KV);
      // Все запросы выпускаются синхронно, до первого await: транзакция
      // коммитится сама, как только очередь микрозадач опустела, и запрос,
      // выпущенный после ожидания, попал бы уже в закрытую.
      const pending = keys.map((key) => req<unknown>(os.get(key)));
      const values = await Promise.all(pending);

      const out: Record<string, string> = {};
      keys.forEach((key, index) => {
        const value = values[index];
        if (typeof value === 'string') out[key] = value;
      });
      return out;
    },

    async getPair(keys) {
      return pairsOf(await store.get(keys));
    },

    async set(key, value) {
      const tx = db.transaction(STORE_KV, 'readwrite');
      tx.objectStore(STORE_KV).put(value, key);
      await txDone(tx);
    },

    async remove(keys) {
      if (keys.length === 0) return;
      const tx = db.transaction(STORE_KV, 'readwrite');
      const os = tx.objectStore(STORE_KV);
      for (const key of keys) os.delete(key);
      await txDone(tx);
    },

    async keys() {
      const tx = db.transaction(STORE_KV, 'readonly');
      const all = await req<IDBValidKey[]>(tx.objectStore(STORE_KV).getAllKeys());
      return all.filter((key): key is string => typeof key === 'string');
    },
  };
  return store;
}

/** Синхронно, до открытия транзакции: внутри неё ждать `localStorage` уже нельзя. */
function readWebStorage(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (!hasWebStorage()) return out;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const raw = localStorage.key(i);
      if (!raw?.startsWith(LOCAL_PREFIX) || raw === MIGRATED_MARK) continue;
      const value = localStorage.getItem(raw);
      if (value !== null) out.push([raw.slice(LOCAL_PREFIX.length), value]);
    }
  } catch (error) {
    console.warn('[storage] старая копия не прочиталась', error);
  }
  return out;
}

/**
 * Разовый перенос старой копии в базу.
 *
 * Прежние ключи из `localStorage` не удаляются: откат на предыдущую сборку
 * иначе оставил бы человека без данных вовсе, а так он потеряет только правки,
 * сделанные после переезда. Ключ, уже лежащий в базе, не перезаписывается —
 * база главнее старой копии.
 */
async function migrateFromWebStorage(db: IDBDatabase): Promise<void> {
  const already = await req<unknown>(
    db.transaction(STORE_META, 'readonly').objectStore(STORE_META).get('migrated'),
  );
  if (already) return;

  const entries = readWebStorage();
  const tx = db.transaction([STORE_KV, STORE_META], 'readwrite');
  const kv = tx.objectStore(STORE_KV);

  if (entries.length > 0) {
    const taken = new Set((await req<IDBValidKey[]>(kv.getAllKeys())).map(String));
    for (const [key, value] of entries) {
      if (!taken.has(key)) kv.put(value, key);
    }
  }
  tx.objectStore(STORE_META).put(1, 'migrated');
  await txDone(tx);

  if (entries.length > 0) console.info(`[storage] в базу перенесено ключей: ${entries.length}`);
}

function markMigrated(): void {
  try {
    if (hasWebStorage()) localStorage.setItem(MIGRATED_MARK, '1');
  } catch {
    // Квота или запрет на запись. Отметка — страховка, а не условие работы.
  }
}

function wasMigrated(): boolean {
  try {
    return hasWebStorage() && localStorage.getItem(MIGRATED_MARK) !== null;
  } catch {
    return false;
  }
}

// --- Выбор реализации --------------------------------------------------------

async function resolveBackend(): Promise<KeyValueStore> {
  try {
    const db = await openDb({
      name: DB_NAME,
      version: DB_VERSION,
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE_KV)) database.createObjectStore(STORE_KV);
        if (!database.objectStoreNames.contains(STORE_META)) database.createObjectStore(STORE_META);
      },
    });
    await migrateFromWebStorage(db);
    markMigrated();
    return idbBacked(db);
  } catch (error) {
    if (wasMigrated()) {
      console.warn('[storage] база не открылась, а данные уже в ней — читать нечего', error);
      return failingStore(error);
    }
    if (hasWebStorage()) {
      console.warn('[storage] IndexedDB недоступен, остаёмся на localStorage', error);
      return webStorageStore;
    }
    console.warn('[storage] постоянного хранилища нет, работаем из памяти', error);
    return memoryStore();
  }
}

/** Выбор делается один раз за сеанс: повторять открытие на каждой операции незачем. */
let chosen: Promise<KeyValueStore> | undefined;

function backend(): Promise<KeyValueStore> {
  chosen ??= resolveBackend();
  return chosen;
}

/**
 * Локальная копия как обычное хранилище. Какой из трёх путей за ней стоит,
 * наверх не видно — иначе выбор пришлось бы делать в каждом месте вызова.
 */
export const localStore: KeyValueStore = {
  kind: 'local',
  isDegraded: () => false,
  get: (keys) => backend().then((store) => store.get(keys)),
  getPair: (keys) => backend().then((store) => store.getPair(keys)),
  set: (key, value) => backend().then((store) => store.set(key, value)),
  remove: (keys) => backend().then((store) => store.remove(keys)),
  keys: () => backend().then((store) => store.keys()),
};

/** Только для тестов: следующий вызов снова выберет реализацию. */
export function resetBackendForTests(): void {
  chosen = undefined;
}
