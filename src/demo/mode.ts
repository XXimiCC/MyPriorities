/**
 * Включено ли демо и насколько подстрижен интерфейс.
 *
 * Единственный файл каталога, который знает про `window`: остальные обязаны
 * собираться в node, иначе тест профилей пришлось бы гонять в браузерной среде
 * ради одного чтения адресной строки.
 *
 * Два разных понятия, которые легко перепутать:
 *
 *   DEMO_MODE  — загружен синтетический набор. Гасит запись целиком: хранилище
 *                подменяется памятью на своей границе, см. `store/local/db.ts`.
 *   GUEST_MODE — приложение показывают другому человеку. Сверху висит плашка
 *                выхода, а из настроек убрано всё, что трогает чужой аккаунт.
 *
 * Разделены намеренно. Скриншоты документации снимаются в демо-данных, но с
 * полным интерфейсом — иначе кадры настроек снять нечем. Поэтому вход через
 * `?mock=` даёт данные без плашки, а `?demo=` — то, что отправляют другу.
 */

import { startParam } from '../telegram/sdk';
import { findProfile, type DemoId } from './profiles';

/** Что отправляют человеку: `?demo=f`. */
const PARAM = 'demo';

/** Вход для разработки и съёмки: `?mock=1` — наследство, читается как профиль «Артём». */
const DEV_PARAM = 'mock';

/**
 * Отметка «демо выключено».
 *
 * Нужна из-за `startapp`: он приезжает в хэше, который переживает перезагрузку,
 * и без явного «нет» выход из демо возвращал бы в него же на следующем кадре.
 */
const OFF = 'off';

/** Префикс ссылки-приглашения: `t.me/<бот>/app?startapp=demo_f`. */
const START_PREFIX = 'demo_';

/**
 * След вышедшего: `?from=burnout`.
 *
 * Ставит его выход из демо, читает онбординг — чтобы предложить набор, на
 * котором это демо и построено. Адрес выбран не из симпатии к нему, а по
 * необходимости: в демо-режиме хранилище подменено памятью на своей границе
 * (`store/local/db.ts`), и записать «я пришёл из „Выгорания“» перед выходом
 * попросту некуда — запись гасится. Перезагрузка при выходе тоже своя, и адрес
 * её переживает.
 */
const FROM_PARAM = 'from';

interface Entry {
  id: DemoId;
  guest: boolean;
}

function resolve(): Entry | undefined {
  if (typeof window === 'undefined') return undefined;

  const query = new URLSearchParams(window.location.search);
  const asked = query.get(PARAM);
  if (asked === OFF) return undefined;

  const shared = findProfile(asked);
  if (shared) return { id: shared.id, guest: true };

  if (query.has(DEV_PARAM)) {
    // `?mock=1` жил здесь до профилей, и на нём же держатся закладки и сценарии
    // съёмки. Единица — не идентификатор, поэтому читается как профиль по умолчанию.
    const named = findProfile(query.get(DEV_PARAM));
    return { id: named?.id ?? 'm', guest: false };
  }

  if (startParam?.startsWith(START_PREFIX)) {
    const invited = findProfile(startParam.slice(START_PREFIX.length));
    if (invited) return { id: invited.id, guest: true };
  }

  return undefined;
}

function leftBehind(): DemoId | undefined {
  if (typeof window === 'undefined') return undefined;
  const asked = new URLSearchParams(window.location.search).get(FROM_PARAM);
  return findProfile(asked)?.id;
}

const entry = resolve();

/** Какой набор загружен. null — обычная работа с настоящими данными. */
export const DEMO_ID: DemoId | null = entry?.id ?? null;

/** Синтетика на экране. Отсюда же гасится вся запись — на границе хранилища. */
export const DEMO_MODE = entry !== undefined;

/** Приложение показывают другому человеку: плашка сверху, урезанные настройки. */
export const GUEST_MODE = entry?.guest ?? false;

/**
 * Демо, из которого только что вышли. null — пришли обычным путём.
 *
 * Читается только снаружи демо: пока синтетика на экране, «откуда вышли»
 * вопрос без смысла, а `from`, случайно оставшийся в адресе рядом с `demo=`,
 * не должен подмешиваться ни во что.
 */
export const FROM_DEMO: DemoId | null = entry === undefined ? (leftBehind() ?? null) : null;

/**
 * Адрес — единственный носитель признака.
 *
 * Отметка в хранилище была бы удобнее ровно до первого приватного режима, где
 * запись запрещена: демо не открылось бы вовсе. Адрес работает везде, виден
 * глазом при разборе и отправляется другу как есть.
 */
function go(mutate: (params: URLSearchParams) => void): void {
  const url = new URL(window.location.href);
  mutate(url.searchParams);
  // replace, а не assign: демо не должно копиться в истории, иначе системная
  // «назад» возвращает в него сразу после выхода.
  window.location.replace(url.toString());
}

export function enterDemo(id: DemoId): void {
  go((params) => {
    params.delete(DEV_PARAM);
    params.delete(FROM_PARAM);
    params.set(PARAM, id);
  });
}

export function leaveDemo(): void {
  go((params) => {
    params.delete(DEV_PARAM);
    // След для онбординга: из какого демо человек только что вышел.
    if (entry) params.set(FROM_PARAM, entry.id);
    /*
     * Явное «нет» нужно только против ссылки-приглашения: `startapp` приезжает
     * в хэше, переживает перезагрузку и без отметки вернул бы в демо на
     * следующем же кадре. В остальных случаях параметр просто убирается —
     * висящий в адресе `demo=off` пришлось бы объяснять на пустом месте.
     */
    if (startParam?.startsWith(START_PREFIX)) params.set(PARAM, OFF);
    else params.delete(PARAM);
  });
}
