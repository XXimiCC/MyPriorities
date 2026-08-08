/**
 * Тонкая обёртка над IndexedDB: колбэки и события превращаются в промисы.
 *
 * Библиотеки вроде `idb` дали бы то же самое, но нам нужны ровно четыре
 * операции — прочитать ключ, прочитать всё, записать, удалить, — а курсоры,
 * ради которых её обычно берут, не нужны вовсе: данных здесь десятки килобайт.
 * Приём тот же, что и в `cloudStorage.ts`, где колбэчный мост Telegram
 * промисифицирован руками.
 *
 * Главное правило, которое ломает IndexedDB чаще всего: внутри транзакции
 * нельзя ждать ничего, кроме её же запросов. Транзакция коммитится сама, как
 * только очередь микрозадач опустела, поэтому `await` чего-то постороннего
 * между двумя `req()` закрывает её на середине. В этом файле и в тех, кто им
 * пользуется, внутри транзакции живёт только `req()`.
 */

/** Один запрос IndexedDB как промис. */
export function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB: запрос отклонён'));
  });
}

/** Завершение транзакции. Ошибку отдаёт и `error`, и `abort`: молчаливый откат хуже отказа. */
export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB: транзакция отклонена'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB: транзакция откачена'));
  });
}

/**
 * Сколько ждать открытия базы.
 *
 * Апгрейд схемы блокируется, пока открыта вкладка со старой версией, — а у нас
 * это обычное дело: сайт и Telegram Web живут на одном домене. Обработчик
 * `versionchange` ниже закрывает соединение сам, но чужая вкладка может висеть
 * в фоне и не получить события вовремя. Ждать её бесконечно нельзя: наверху
 * это выглядит как бесконечный спиннер, ровно тот, от которого защищает
 * `HYDRATE_DEADLINE_MS`.
 */
const OPEN_TIMEOUT_MS = 2000;

/**
 * База недоступна: приватный режим, отключённое хранилище, зависший апгрейд.
 *
 * Причина кладётся в поле руками: `Error` с опциями появился только в ES2022,
 * а проект собирается под ES2020.
 */
export class IdbUnavailable extends Error {
  readonly reasonCause: unknown;

  constructor(reason: string, options?: { cause?: unknown }) {
    super(`IndexedDB недоступен: ${reason}`);
    this.name = 'IdbUnavailable';
    this.reasonCause = options?.cause;
  }
}

export interface OpenOptions {
  name: string;
  version: number;
  /** Создание и правка хранилищ. Вызывается внутри транзакции апгрейда — только синхронный код. */
  upgrade(db: IDBDatabase, fromVersion: number, tx: IDBTransaction): void;
}

/**
 * Открывает базу. Соединение само закрывается, когда другая вкладка просит
 * апгрейд, — иначе она будет ждать нас, а мы её, и обе упрутся в предел.
 */
export function openDb({ name, version, upgrade }: OpenOptions): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new IdbUnavailable('объекта indexedDB нет в этой среде'));
  }

  let request: IDBOpenDBRequest;
  try {
    request = indexedDB.open(name, version);
  } catch (error) {
    // В приватном режиме отдельных браузеров сам вызов бросает.
    return Promise.reject(new IdbUnavailable('открытие отклонено', { cause: error }));
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    let done = false;
    const finish = (): boolean => {
      if (done) return false;
      done = true;
      clearTimeout(timer);
      return true;
    };

    // Глобальный setTimeout, а не window.setTimeout, как в остальном коде: этот
    // модуль поднимается в юнит-тестах под node, где window нет. Ровно та же
    // причина, по которой в sdk.ts стоит проверка typeof window.
    const timer = setTimeout(() => {
      if (finish()) reject(new IdbUnavailable(`открытие не завершилось за ${OPEN_TIMEOUT_MS} мс`));
    }, OPEN_TIMEOUT_MS);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (!tx) return;
      try {
        upgrade(db, event.oldVersion, tx);
      } catch (error) {
        tx.abort();
        if (finish()) reject(new IdbUnavailable('апгрейд схемы не удался', { cause: error }));
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // Чужая вкладка запросила версию новее — уходим с дороги, иначе её
      // открытие висит до предела ожидания, а наши записи всё равно упадут.
      db.onversionchange = () => db.close();
      if (finish()) resolve(db);
      else db.close();
    };

    request.onerror = () => {
      if (finish()) reject(new IdbUnavailable('открытие отклонено', { cause: request.error }));
    };

    // Ждём не молча: без этого предел ожидания выглядит как «база просто не отвечает».
    request.onblocked = () => {
      console.warn('[idb] апгрейд ждёт другую вкладку');
    };
  });
}
