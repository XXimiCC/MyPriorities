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

import { DEMO_MODE } from '../../demo/mode';
import type { Op } from '../../sync/ops';
import type { KeyValueStore, ValuePair } from '../kv';
import { IdbUnavailable, openDb, req, txDone } from './idb';

const DB_NAME = 'mypri';
const DB_VERSION = 2;
/** Данные пользователя: ключи те же `mp:*`, что и в CloudStorage. */
const STORE_KV = 'kv';
/** Служебное: сюда не попадают ключи данных, поэтому `keys()` не приходится фильтровать. */
const STORE_META = 'meta';
/** Журнал операций. Появился во второй версии схемы. */
const STORE_OPS = 'ops';
/**
 * Индекс очереди отправки. Значение — 0 или 1, а не булево: булевы значения
 * IndexedDB индексировать не умеет.
 */
const INDEX_SYNCED = 'by_synced';

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

/**
 * Открывалось ли приложение на этом устройстве по-настоящему.
 *
 * Отметка та же, что и у переезда, и это не экономия на ключе: её ставит
 * успешное открытие базы, то есть ровно тот сеанс, в котором данные читались и
 * писались всерьёз. Демо до неё не доходит — `resolveBackend` возвращает память
 * раньше, — поэтому у человека, впервые открывшего приложение по демо-ссылке,
 * отметки нет, а у владельца, зашедшего в демо из настроек, она есть с
 * прошлого кадра.
 *
 * Ответ приблизительный по построению: в приватном режиме, где IndexedDB
 * закрыт, отметки не будет и у старожила. Цена промаха — одна фраза в
 * подтверждении выхода из демо, поэтому точнее не нужно.
 */
export function usedBefore(): boolean {
  return wasMigrated();
}

// --- Журнал операций ---------------------------------------------------------

/**
 * Операция, как она лежит в базе.
 *
 * `synced` — признак доставки на сервер. Индекс по нему и есть очередь
 * отправки: «что накопилось, пока не было сети» — это выборка по нулю.
 */
interface StoredOp extends Op {
  synced: 0 | 1;
}

export interface OpsLog {
  /**
   * `synced: 1` — для пришедшего с сервера: оно там уже есть, и отправлять его
   * обратно незачем. Флагом при вставке, а не отдельной отметкой следом, чтобы
   * не писать одну и ту же строку дважды.
   */
  append(ops: Op[], synced?: 0 | 1): Promise<void>;
  /** Всё, что есть: из этого строится проекция при запуске. */
  all(): Promise<Op[]>;
  /** Ещё не доставленное серверу. */
  pending(): Promise<Op[]>;
  /**
   * Отметить доставленным. Принимает сами операции, а не идентификаторы:
   * у вызывающего они на руках, и перечитывать их из базы ради одного флага —
   * лишние чтение и запись на каждую строку.
   */
  markSynced(ops: Op[]): Promise<void>;
  /** Полная очистка журнала. Нужна после свёртки и при сбросе кабинета. */
  clear(): Promise<void>;
  meta(key: string): Promise<unknown>;
  setMeta(key: string, value: unknown): Promise<void>;
}

function strip(row: StoredOp): Op {
  const { synced: _drop, ...op } = row;
  return op;
}

function idbOps(db: IDBDatabase): OpsLog {
  return {
    async append(ops, synced = 0) {
      if (ops.length === 0) return;
      const tx = db.transaction(STORE_OPS, 'readwrite');
      const os = tx.objectStore(STORE_OPS);
      // put, а не add: повторная запись той же операции должна быть безобидна,
      // иначе повтор доставки ронял бы всю пачку целиком.
      for (const op of ops) os.put({ ...op, synced } satisfies StoredOp);
      await txDone(tx);
    },

    async all() {
      const tx = db.transaction(STORE_OPS, 'readonly');
      const rows = await req<StoredOp[]>(tx.objectStore(STORE_OPS).getAll());
      return rows.map(strip);
    },

    async pending() {
      const tx = db.transaction(STORE_OPS, 'readonly');
      const rows = await req<StoredOp[]>(
        tx.objectStore(STORE_OPS).index(INDEX_SYNCED).getAll(0),
      );
      return rows.map(strip);
    },

    async markSynced(ops) {
      if (ops.length === 0) return;
      const tx = db.transaction(STORE_OPS, 'readwrite');
      const os = tx.objectStore(STORE_OPS);
      for (const op of ops) os.put({ ...op, synced: 1 } satisfies StoredOp);
      await txDone(tx);
    },

    async clear() {
      const tx = db.transaction(STORE_OPS, 'readwrite');
      tx.objectStore(STORE_OPS).clear();
      await txDone(tx);
    },

    async meta(key) {
      const tx = db.transaction(STORE_META, 'readonly');
      return req<unknown>(tx.objectStore(STORE_META).get(key));
    },

    async setMeta(key, value) {
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.objectStore(STORE_META).put(value, key);
      await txDone(tx);
    },
  };
}

/**
 * Журнал в памяти. Между запусками не живёт, но позволяет работать до конца
 * сеанса — а пока идёт двойная запись, источником истины остаётся CloudStorage,
 * и потеря журнала не потеря данных.
 */
function memoryOps(): OpsLog {
  const rows = new Map<string, StoredOp>();
  const meta = new Map<string, unknown>();
  return {
    async append(ops, synced = 0) {
      for (const op of ops) rows.set(op.opId, { ...op, synced });
    },
    async all() {
      return [...rows.values()].map(strip);
    },
    async pending() {
      return [...rows.values()].filter((row) => row.synced === 0).map(strip);
    },
    async markSynced(ops) {
      for (const op of ops) rows.set(op.opId, { ...op, synced: 1 });
    },
    async clear() {
      rows.clear();
    },
    async meta(key) {
      return meta.get(key);
    },
    async setMeta(key, value) {
      meta.set(key, value);
    },
  };
}

// --- Выбор реализации --------------------------------------------------------

interface Local {
  kv: KeyValueStore;
  ops: OpsLog;
}

async function resolveBackend(): Promise<Local> {
  /*
   * Демо не касается диска — и это единственное место, где такое решение
   * принимается.
   *
   * Раньше синтетику держали от записи четырнадцать ранних возвратов в сторе, по
   * одному на каждую точку записи. Пока стоком был один CloudStorage, это ещё
   * работало; с журналом операций и сервером каждый новый путь записи стал
   * пятнадцатым местом, которое надо не забыть, а цена промаха выросла с
   * «испорчено облако одного устройства» до «операция разъехалась по всем».
   *
   * Предохранитель на границе переворачивает режим отказа: забытое место больше
   * не течёт наружу, а просто остаётся в памяти. Заодно сюда попадают сессия и
   * идентификатор устройства — они ходят через `meta` этого же хранилища.
   */
  if (DEMO_MODE) return { kv: memoryStore(), ops: memoryOps() };

  try {
    const db = await openDb({
      name: DB_NAME,
      version: DB_VERSION,
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE_KV)) database.createObjectStore(STORE_KV);
        if (!database.objectStoreNames.contains(STORE_META)) database.createObjectStore(STORE_META);
        if (!database.objectStoreNames.contains(STORE_OPS)) {
          const ops = database.createObjectStore(STORE_OPS, { keyPath: 'opId' });
          ops.createIndex(INDEX_SYNCED, 'synced');
        }
      },
    });
    await migrateFromWebStorage(db);
    markMigrated();
    return { kv: idbBacked(db), ops: idbOps(db) };
  } catch (error) {
    if (wasMigrated()) {
      console.warn('[storage] база не открылась, а данные уже в ней — читать нечего', error);
      return { kv: failingStore(error), ops: memoryOps() };
    }
    if (hasWebStorage()) {
      console.warn('[storage] IndexedDB недоступен, остаёмся на localStorage', error);
      return { kv: webStorageStore, ops: memoryOps() };
    }
    console.warn('[storage] постоянного хранилища нет, работаем из памяти', error);
    return { kv: memoryStore(), ops: memoryOps() };
  }
}

/** Выбор делается один раз за сеанс: повторять открытие на каждой операции незачем. */
let chosen: Promise<Local> | undefined;

function backend(): Promise<Local> {
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
  get: (keys) => backend().then(({ kv }) => kv.get(keys)),
  getPair: (keys) => backend().then(({ kv }) => kv.getPair(keys)),
  set: (key, value) => backend().then(({ kv }) => kv.set(key, value)),
  remove: (keys) => backend().then(({ kv }) => kv.remove(keys)),
  keys: () => backend().then(({ kv }) => kv.keys()),
};

/**
 * Запись идёт цепочкой, а не поверх предыдущей.
 *
 * Порядок операций в журнале сам по себе не важен — на то и метки времени, — но
 * две параллельные транзакции на одну базу означали бы, что вторая может
 * завершиться раньше первой, а ошибка первой потеряется молча. Приём тот же,
 * что у `pendingSettings` в сторе.
 */
let chain: Promise<void> = Promise.resolve();

export const opsLog: OpsLog = {
  append(ops, synced) {
    const done = chain.then(() => backend().then(({ ops: log }) => log.append(ops, synced)));
    chain = done.catch((error) => console.warn('[storage] операции не записались', error));
    return done;
  },
  all: () => backend().then(({ ops }) => ops.all()),
  pending: () => backend().then(({ ops }) => ops.pending()),
  markSynced: (ops) => backend().then(({ ops: log }) => log.markSynced(ops)),
  clear: () => backend().then(({ ops }) => ops.clear()),
  meta: (key) => backend().then(({ ops }) => ops.meta(key)),
  setMeta: (key, value) => backend().then(({ ops }) => ops.setMeta(key, value)),
};

/** Только для тестов: следующий вызов снова выберет реализацию. */
export function resetBackendForTests(): void {
  chosen = undefined;
  chain = Promise.resolve();
}
