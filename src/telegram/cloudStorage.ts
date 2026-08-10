/**
 * Хранилище ключ-значение поверх Telegram CloudStorage с фолбэком на локальную копию.
 *
 * CloudStorage привязан к аккаунту и синхронизируется между устройствами, но
 * даёт колбэки вместо промисов и жёстко ограничен 4096 символами на значение.
 * Оба ограничения закрываются здесь, чтобы выше по стеку об этом не думать.
 *
 * Где именно живёт локальная копия — IndexedDB, localStorage или память —
 * решает `store/local/db.ts`; сюда это не просачивается.
 */

import { DEMO_MODE } from '../demo/mode';
import { localStore } from '../store/local/db';
import type { KeyValueStore, ValuePair } from '../store/kv';
import { cloudStorage } from './sdk';

export const VALUE_LIMIT = 4096;

export type { KeyValueStore, ValuePair };

/**
 * Мост Telegram передаёт ответ одним сообщением, поэтому длинный список ключей
 * запрашиваем частями. Тринадцать месяцев — это 26 ключей по 4 КБ, и на десктопных
 * реализациях такой ответ надёжнее разбить, чем проверять эмпирически, где он порвётся.
 */
const GET_BATCH = 8;

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
    // Батчи идут параллельно: последовательно тринадцать месяцев упирались в предел
    // ожидания гидратации раньше, чем успевали прочитаться, и ответ облака выбрасывался.
    const batches: Array<Promise<Record<string, string>>> = [];
    for (let i = 0; i < keys.length; i += GET_BATCH) {
      batches.push(getBatch(keys.slice(i, i + GET_BATCH)));
    }
    const out: Record<string, string> = {};
    for (const part of await Promise.all(batches)) Object.assign(out, part);
    return out;
  },
  async getPair(keys) {
    const out: Record<string, ValuePair> = {};
    for (const [key, value] of Object.entries(await cloudStore.get(keys))) {
      out[key] = { remote: value };
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
/**
 * Сколько ждать до новой попытки после отказа облака.
 *
 * Раньше первый же таймаут выключал синхронизацию до перезапуска мини-аппа:
 * одна заминка сети означала, что весь сеанс пишется только на это устройство,
 * и человек об этом узнавал в лучшем случае из строки в настройках. Пауза нужна,
 * чтобы не долбить зависший мост на каждой записи, но не навсегда.
 */
const CLOUD_RETRY_AFTER_MS = 30_000;

function mirrored(primary: KeyValueStore): KeyValueStore {
  let brokenUntil = 0;
  let everBroken = false;

  const fallback = async <T>(op: () => Promise<T>, alt: () => Promise<T>): Promise<T> => {
    if (performance.now() < brokenUntil) return alt();
    try {
      const result = await op();
      if (everBroken) {
        console.warn('[storage] CloudStorage снова отвечает');
        everBroken = false;
      }
      return result;
    } catch (error) {
      console.warn('[storage] CloudStorage отказал, переходим на localStorage', error);
      brokenUntil = performance.now() + CLOUD_RETRY_AFTER_MS;
      everBroken = true;
      return alt();
    }
  };

  /**
   * Локальная копия — не источник истины, и её отказ не должен ронять облачный путь.
   * Хранилище на устройстве бросает в приватном режиме Safari, в вебвью с отключённым
   * хранилищем и при переполнении квоты. Раньше это выбивало чтение целиком,
   * приложение стартовало пустым и первой же записью затирало живое облако.
   *
   * Глушить здесь безопасно именно потому, что рядом есть облако: пустая копия
   * означает лишь «показываем то, что пришло из сети». Там, где копия читается
   * без облака — `readLocalOnly` и прямой `localMirror`, — отказ, наоборот,
   * пробрасывается и поднимает `loadFailed`.
   *
   * Латч `broken` здесь не трогаем: сломалась копия, а не синхронизация.
   */
  const localSafe = async <T>(op: () => Promise<T>, alt: T): Promise<T> => {
    try {
      return await op();
    } catch (error) {
      console.warn('[storage] локальная копия недоступна', error);
      return alt;
    }
  };

  return {
    kind: 'cloud',
    isDegraded: () => everBroken,
    async get(keys) {
      const local = await localSafe(() => localStore.get(keys), {} as Record<string, string>);
      const remote = await fallback(
        () => primary.get(keys),
        () => Promise.resolve({} as Record<string, string>),
      );
      return { ...local, ...remote };
    },
    async getPair(keys) {
      const local = await localSafe(() => localStore.get(keys), {} as Record<string, string>);
      const remote = await fallback(
        () => primary.get(keys),
        () => Promise.resolve({} as Record<string, string>),
      );

      const out: Record<string, ValuePair> = {};
      for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
        out[key] = { local: local[key], remote: remote[key] };
      }
      return out;
    },
    async set(key, value) {
      await localSafe(() => localStore.set(key, value), undefined);
      await fallback(
        () => primary.set(key, value),
        () => Promise.resolve(),
      );
    },
    async remove(keys) {
      await localSafe(() => localStore.remove(keys), undefined);
      await fallback(
        () => primary.remove(keys),
        () => Promise.resolve(),
      );
    },
    async keys() {
      const local = await localSafe(() => localStore.keys(), [] as string[]);
      const remote = await fallback(
        () => primary.keys(),
        () => Promise.resolve([] as string[]),
      );
      return [...new Set([...local, ...remote])];
    },
  };
}

/*
 * В демо облака нет даже внутри клиента: `localStore` там подменён памятью
 * (`store/local/db.ts`), и подмешивать к нему настоящий CloudStorage значило бы
 * оставить синтетике ровно один путь наружу — самый дорогой из всех.
 */
export const store: KeyValueStore =
  cloudStorage && !DEMO_MODE ? mirrored(cloudStore) : localStore;

/**
 * Прямой доступ к локальной копии в обход облака. Нужен ровно на один случай:
 * клиент завис и ждать его больше нельзя, а показать что-то надо.
 */
export const localMirror: KeyValueStore = localStore;
