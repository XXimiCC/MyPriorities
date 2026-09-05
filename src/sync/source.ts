/**
 * Откуда человек пришёл.
 *
 * Метка отвечает ровно на один вопрос: пришёл ли кто-нибудь по конкретной
 * ссылке — по статье, по каталогу, по посту в канале. Задним числом этот ответ
 * не восстанавливается: не записали в момент появления профиля — не узнаем
 * никогда, потому что больше нигде след не остаётся.
 *
 * Носителей два, и оба в проекте уже есть:
 *
 *   ?utm_source=<метка>    — вход в браузере. Имя не наше: так метку называют
 *                            все счётчики, и когда аналитика появится, читать
 *                            она будет уже проставленный параметр, а не второй
 *                            рядом. Лендинг доносит метку сюда сам, см.
 *                            landing/src/entry.js.
 *   startapp=src_<метка>   — вход из Telegram. Приезжает в хэше, переживает
 *                            перезагрузку и разбирается тем же способом, что и
 *                            `demo_` в src/demo/mode.ts.
 *
 * Почему у входа из Telegram имя другое: `startapp` — единственный параметр,
 * который клиент доносит до мини-аппа, всё остальное в ссылке `t.me` он молча
 * теряет. Значит имя и значение приходится складывать в него вдвоём, а его
 * алфавит `=` не допускает. Отсюда `src_` — префикс вместо параметра.
 *
 * Префикс обязателен: тот же `startapp` уже занят демо-профилями, и голая метка
 * была бы неотличима от приглашения посмотреть чужую жизнь.
 *
 *   startapp=demo_max_src_habr — и то, и другое сразу.
 *
 * Совмещённая форма нужна каталогам: рядом с обычной ссылкой в карточке стоит
 * демо-ссылка, и она выглядит привлекательнее. Без совмещения весь, кто нажал
 * именно её, для метки не существует — и живой канал выглядел бы мёртвым.
 *
 * Дальше метка едет на сервер тем же запросом, которым заводится сессия
 * (`sync/auth.ts`) — отдельного события с клиента нет и не будет. Сервер
 * запишет её только при создании профиля: у человека, который завёл профиль
 * полгода назад, источник — не сегодняшняя ссылка.
 */

import { startParam } from '../telegram/sdk';

/** Хвост `startapp`, которым метка отличается от демо-профиля. */
const START_PREFIX = 'src_';

/** Тот же префикс внутри демо-приглашения: `startapp=demo_max_src_habr`. */
const START_MARK = '_src_';

/** Начало демо-приглашения. Разбирается целиком в src/demo/mode.ts. */
const DEMO_PREFIX = 'demo_';

/** Тот же смысл в адресной строке браузера: `?utm_source=habr`. */
const PARAM = 'utm_source';

/**
 * Что вообще может быть меткой.
 *
 * Набор уже, чем позволяет Telegram, и это намеренно: значение приходит из
 * адреса, ложится в базу и печатается в ночном отчёте письмом с HTML. Узкий
 * алфавит снимает вопрос об экранировании на всём пути разом. Ту же проверку
 * сервер повторяет у себя — «клиент уже проверил» доводом не считается.
 */
const SHAPE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** Где метка пережидает возврат из Telegram: адрес его не переживает. */
const KEEP_KEY = 'mypri.source';

function clean(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  return SHAPE.test(value) ? value : undefined;
}

/**
 * Разбор без обращения к `window` — чтобы проверялся обычным тестом в node,
 * как и разбор демо-входа рядом.
 *
 * Адресная строка идёт первой: внутри Telegram её задают настройки бота, и
 * `utm_source` там взяться неоткуда, а в браузере она единственный носитель.
 */
export function readSource(search: string, start: string | undefined): string | undefined {
  const asked = clean(new URLSearchParams(search).get(PARAM));
  if (asked) return asked;
  if (!start) return undefined;

  /*
   * Регистр снимается до разбора, а не после: ссылку в карточке каталога
   * правит модератор, и `SRC_HABR` от него — не повод потерять канал целиком.
   */
  const tail = start.toLowerCase();

  /*
   * Демо-приглашение с меткой. Проверяется раньше голого `src_`, потому что
   * метка здесь стоит в хвосте, а не в начале, и по началу строки её не найти.
   */
  if (tail.startsWith(DEMO_PREFIX)) {
    const at = tail.indexOf(START_MARK);
    return at === -1 ? undefined : clean(tail.slice(at + START_MARK.length));
  }

  if (tail.startsWith(START_PREFIX)) return clean(tail.slice(START_PREFIX.length));
  return undefined;
}

function stored(): string | undefined {
  try {
    return clean(sessionStorage.getItem(KEEP_KEY));
  } catch {
    return undefined;
  }
}

function keep(value: string): void {
  try {
    sessionStorage.setItem(KEEP_KEY, value);
  } catch {
    /*
     * Приватный режим. Единственное последствие — метка не переживёт возврата
     * из Telegram; ради него городить проверку выше по коду незачем.
     */
  }
}

function resolve(): string | undefined {
  if (typeof window === 'undefined') return undefined;

  const found = readSource(window.location.search, startParam);
  if (found) {
    keep(found);
    return found;
  }
  /*
   * Вход через браузер уводит на сторону Telegram и возвращает на голый адрес:
   * `redirectUri()` в sync/oauth.ts — это origin и слэш, и ни `?utm_source=`,
   * ни `startapp` до входа в профиль так не доживают.
   *
   * Тем же хранилищем метка переживает выход из демо: `leaveDemo()` в
   * src/demo/mode.ts перезагружает вкладку с `?demo=off`, и синхронизация
   * оживает уже на следующем кадре — но метка при этом должна остаться той же,
   * с которой человек пришёл.
   */
  return stored();
}

/** Метка этого запуска. undefined — пришли без метки, и это обычное дело. */
export const source = resolve();
