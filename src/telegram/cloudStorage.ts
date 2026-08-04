/**
 * Хранилище ключ-значение поверх Telegram CloudStorage с фолбэком на localStorage.
 *
 * CloudStorage привязан к аккаунту и синхронизируется между устройствами, но
 * даёт колбэки вместо промисов и жёстко ограничен 4096 символами на значение.
 * Оба ограничения закрываются здесь, чтобы выше по стеку об этом не думать.
 */

import { cloudStorage } from './sdk';

export const VALUE_LIMIT = 4096;

export interface KeyValueStore {
  readonly kind: 'cloud' | 'local';
  get(keys: string[]): Promise<Record<string, string>>;
  set(key: string, value: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
  keys(): Promise<string[]>;
  /** Облако было выбрано, но отказало на ходу — синхронизации между устройствами нет. */
  isDegraded(): boolean;
}

/**
 * Мост Telegram передаёт ответ одним сообщением, поэтому длинный список ключей
 * запрашиваем частями. Тринадцать месяцев — это 26 ключей по 4 КБ, и на десктопных
 * реализациях такой ответ надёжнее разбить, чем проверять эмпирически, где он порвётся.
 */
const GET_BATCH = 8;

/** Свой префикс, чтобы локальная копия не путалась с чужими ключами на том же домене. */
const LOCAL_PREFIX = 'mypri/';

const localStore: KeyValueStore = {
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
      if (raw?.startsWith(LOCAL_PREFIX)) out.push(raw.slice(LOCAL_PREFIX.length));
    }
    return out;
  },
};

function getBatch(keys: string[]): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    cloudStorage!.getItems(keys, (err, values) => {
      if (err) return reject(new Error(err));
      // Отсутствующий ключ приходит пустой строкой — отличить его от пустого
      // значения нельзя, поэтому пустые просто отбрасываем.
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(values ?? {})) {
        if (value) out[key] = value;
      }
      resolve(out);
    });
  });
}

const cloudStore: KeyValueStore = {
  kind: 'cloud',
  isDegraded: () => false,
  async get(keys) {
    if (keys.length === 0) return {};
    const out: Record<string, string> = {};
    for (let i = 0; i < keys.length; i += GET_BATCH) {
      Object.assign(out, await getBatch(keys.slice(i, i + GET_BATCH)));
    }
    return out;
  },
  set(key, value) {
    return new Promise((resolve, reject) => {
      cloudStorage!.setItem(key, value, (err) => (err ? reject(new Error(err)) : resolve()));
    });
  },
  remove(keys) {
    if (keys.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      cloudStorage!.removeItems(keys, (err) => (err ? reject(new Error(err)) : resolve()));
    });
  },
  keys() {
    return new Promise((resolve, reject) => {
      cloudStorage!.getKeys((err, keys) => (err ? reject(new Error(err)) : resolve(keys ?? [])));
    });
  },
};

/**
 * Пишем в облако, а рядом всегда держим локальную копию. Копия решает две
 * задачи: мгновенная отрисовка на старте, пока облако ещё отвечает, и
 * сохранность данных, если CloudStorage откажет посреди сессии.
 */
function mirrored(primary: KeyValueStore): KeyValueStore {
  let broken = false;

  const fallback = async <T>(op: () => Promise<T>, alt: () => Promise<T>): Promise<T> => {
    if (broken) return alt();
    try {
      return await op();
    } catch (error) {
      console.warn('[storage] CloudStorage отказал, переходим на localStorage', error);
      broken = true;
      return alt();
    }
  };

  return {
    kind: 'cloud',
    isDegraded: () => broken,
    async get(keys) {
      const local = await localStore.get(keys);
      const remote = await fallback(
        () => primary.get(keys),
        () => Promise.resolve({} as Record<string, string>),
      );
      return { ...local, ...remote };
    },
    async set(key, value) {
      await localStore.set(key, value);
      await fallback(
        () => primary.set(key, value),
        () => Promise.resolve(),
      );
    },
    async remove(keys) {
      await localStore.remove(keys);
      await fallback(
        () => primary.remove(keys),
        () => Promise.resolve(),
      );
    },
    async keys() {
      const local = await localStore.keys();
      const remote = await fallback(
        () => primary.keys(),
        () => Promise.resolve([] as string[]),
      );
      return [...new Set([...local, ...remote])];
    },
  };
}

export const store: KeyValueStore = cloudStorage ? mirrored(cloudStore) : localStore;
