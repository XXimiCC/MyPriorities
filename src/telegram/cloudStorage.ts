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

/**
 * Предел ожидания ответа от облака.
 *
 * CloudStorage общается через мост клиента и отвечает колбэком. Колбэк, который
 * не вызвали ни с ошибкой, ни с успехом, — это не гипотеза: так ведут себя
 * отдельные сборки Telegram, где объект есть, а обработчика за ним нет.
 * Без предела промис висит вечно, гидратация не завершается, и пользователь
 * видит бесконечный спиннер вместо приложения.
 */
const CLOUD_TIMEOUT_MS = 4000;

function withTimeout<T>(operation: string, run: (settle: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(`CloudStorage.${operation}: клиент не ответил за ${CLOUD_TIMEOUT_MS} мс`));
    }, CLOUD_TIMEOUT_MS);

    const finish = (): boolean => {
      if (done) return false;
      done = true;
      window.clearTimeout(timer);
      return true;
    };

    run(
      (value) => finish() && resolve(value),
      (error) => finish() && reject(error),
    );
  });
}

function getBatch(keys: string[]): Promise<Record<string, string>> {
  return withTimeout<Record<string, string>>('getItems', (settle, fail) => {
    cloudStorage!.getItems(keys, (err, values) => {
      if (err) return fail(new Error(err));
      // Отсутствующий ключ приходит пустой строкой — отличить его от пустого
      // значения нельзя, поэтому пустые просто отбрасываем.
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(values ?? {})) {
        if (value) out[key] = value;
      }
      settle(out);
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
    return withTimeout<void>('setItem', (settle, fail) => {
      cloudStorage!.setItem(key, value, (err) => (err ? fail(new Error(err)) : settle()));
    });
  },
  remove(keys) {
    if (keys.length === 0) return Promise.resolve();
    return withTimeout<void>('removeItems', (settle, fail) => {
      cloudStorage!.removeItems(keys, (err) => (err ? fail(new Error(err)) : settle()));
    });
  },
  keys() {
    return withTimeout<string[]>('getKeys', (settle, fail) => {
      cloudStorage!.getKeys((err, list) => (err ? fail(new Error(err)) : settle(list ?? [])));
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

/**
 * Прямой доступ к локальной копии в обход облака. Нужен ровно на один случай:
 * клиент завис и ждать его больше нельзя, а показать что-то надо.
 */
export const localMirror: KeyValueStore = localStore;
