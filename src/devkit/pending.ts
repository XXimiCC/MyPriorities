/**
 * Отметка «в очереди что-то лежит» и моменты, когда стоит попробовать снова.
 *
 * Отдельный крошечный модуль — ради веса. Отправка и очередь тянут за собой
 * IndexedDB, сборку тикета и работу с multipart; всё это грузится ленивым
 * куском вместе с самой панелью. Но узнать, есть ли что досылать, надо на
 * каждом запуске у всех — поэтому признак живёт в localStorage и читается
 * одной строкой, без единого лишнего килобайта в основном бандле.
 *
 * localStorage, а не IndexedDB: тут одна булева отметка, синхронное чтение
 * ничего не стоит, а асинхронное потребовало бы поднять всю очередь ради
 * ответа «нет».
 */

const KEY = 'devkit:outbox';

/** Задержка первой досылки: она не должна конкурировать с первой отрисовкой. */
const FIRST_FLUSH_MS = 4000;

/** Возвращение на вкладку — повод попробовать, но не чаще раза в минуту. */
const VISIBLE_THROTTLE_MS = 60_000;

export function markPending(pending: boolean): void {
  try {
    if (pending) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* приватный режим или запрет хранилища: досылка тогда живёт один сеанс */
  }
}

export function hasPending(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Моменты повтора — по событиям, без опроса: вернулась сеть, вернулись на
 * вкладку, прошло несколько секунд после запуска. Таймер, тикающий вхолостую
 * весь сеанс, стоил бы дороже всего, что он сторожит.
 */
export function watchPending(flush: () => void): () => void {
  let lastVisible = 0;

  const tryFlush = (): void => {
    if (hasPending()) flush();
  };

  const onVisible = (): void => {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastVisible < VISIBLE_THROTTLE_MS) return;
    lastVisible = now;
    tryFlush();
  };

  const first = window.setTimeout(tryFlush, FIRST_FLUSH_MS);
  window.addEventListener('online', tryFlush);
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    window.clearTimeout(first);
    window.removeEventListener('online', tryFlush);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
