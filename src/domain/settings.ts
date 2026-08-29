/**
 * Настройки как значение: создание, приведение к валидному виду, идентификаторы.
 *
 * Ничего про хранилище здесь нет намеренно. Проверка чужого ввода — забота
 * домена: одни и те же правила нужны и записи из CloudStorage, и строке из
 * Postgres, и файлу копии, который человек мог поправить руками. Раньше всё это
 * жило в `store/persistence.ts` вместе с ключами и лимитом в 4096 байт, и
 * подменить транспорт, не задев проверки, было нельзя.
 */

import { DEFAULT_PRIORITIES, titlesOf } from './presets';
import type { Priority, Settings } from './types';
import { DEFAULT_BLOCK_MINUTES, DEFAULT_MODULES, MAX_PRIORITIES, sanitizeModules } from './types';

/**
 * Архив нужен только ради подписей в статистике, поэтому он ограничен.
 *
 * Прежнее число упиралось в лимит значения CloudStorage; теперь ограничение
 * только смысловое — имя приоритета, удалённого сто правок назад, статистике
 * уже ничего не объясняет.
 */
export const MAX_ARCHIVED = 120;

// --- Идентификаторы ----------------------------------------------------------

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Двухсимвольный id: короткий, потому что он повторяется в каждом дне истории. */
export function newShortId(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let length = 2; length <= 4; length += 1) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      let id = '';
      for (let i = 0; i < length; i += 1) {
        id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
      }
      if (!used.has(id)) return id;
    }
  }
  return `x${Date.now().toString(36)}`;
}

// --- Настройки ---------------------------------------------------------------

export function emptySettings(): Settings {
  return {
    version: 1,
    priorities: [],
    archived: [],
    onboarded: false,
    blockMinutes: DEFAULT_BLOCK_MINUTES,
    modules: { ...DEFAULT_MODULES },
  };
}

/** Разворачивает пресет или список названий в приоритеты, переиспользуя уже известные id. */
export function materialize(
  source: Array<{ title: string; colorId: number }>,
  known: Priority[],
): Priority[] {
  const byTitle = new Map(known.map((p) => [p.title.trim().toLowerCase(), p]));
  const taken = new Set(known.map((p) => p.id));
  const out: Priority[] = [];

  for (const item of source.slice(0, MAX_PRIORITIES)) {
    // Совпадение по названию сохраняет историю: «Работа» из одного набора и из
    // другого — это один и тот же приоритет, а не два разных с нуля.
    const existing = byTitle.get(item.title.trim().toLowerCase());
    const id = existing?.id ?? newShortId(taken);
    taken.add(id);
    out.push({ id, title: item.title, colorId: item.colorId });
  }
  return out;
}

export function defaultSettings(): Settings {
  const base = emptySettings();
  return { ...base, priorities: materialize(titlesOf(DEFAULT_PRIORITIES), []) };
}

export function sanitizeSettings(raw: unknown): Settings | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Partial<Settings>;
  if (!Array.isArray(value.priorities)) return undefined;

  const clean = (list: unknown): Priority[] =>
    (Array.isArray(list) ? list : [])
      .filter((p): p is Priority =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as Priority).id === 'string' &&
        typeof (p as Priority).title === 'string',
      )
      .map((p) => {
        // Отрицательный индекс цвета ломает выбор из палитры: -1 % 10 === -1,
        // и обращение по такому индексу не даёт ничего.
        const colorId = Number(p.colorId);
        return {
          id: p.id,
          title: p.title,
          colorId: Number.isFinite(colorId) && colorId >= 0 ? Math.floor(colorId) : 0,
        };
      });

  /** Оставляет первое вхождение каждого id и помечает его как занятое. */
  const dedupe = (list: Priority[], seen: Set<string>): Priority[] =>
    list.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

  /*
   * Срез по потолку идёт до того, как id попадут в общий `seen`.
   *
   * Раньше множество заполнялось всем списком сразу, поэтому приоритет,
   * вытесненный лимитом, считался уже виденным и выбрасывался ещё и из архива —
   * исчезал целиком, а его история в месяцах оставалась без подписи. Теперь
   * лишние уходят в архив, ради которого он и существует.
   */
  const all = dedupe(clean(value.priorities), new Set<string>());
  const priorities = all.slice(0, MAX_PRIORITIES);
  const overflow = all.slice(MAX_PRIORITIES);

  const seen = new Set(priorities.map((p) => p.id));
  // Вытесненные дописываются в хвост: срез архива оставляет именно последние.
  const archived = dedupe([...clean(value.archived), ...overflow], seen).slice(-MAX_ARCHIVED);

  const blockMinutes = Number(value.blockMinutes);
  return {
    version: 1,
    priorities,
    archived,
    presetId: typeof value.presetId === 'string' ? value.presetId : undefined,
    onboarded: Boolean(value.onboarded) || priorities.length > 0,
    // Настройки, записанные до появления этого поля, читаются как значение по умолчанию.
    blockMinutes: Number.isFinite(blockMinutes) && blockMinutes > 0 ? blockMinutes : DEFAULT_BLOCK_MINUTES,
    modules: sanitizeModules(value.modules),
    /*
     * Отметки о единожды случившемся: только явное `true` считается «было».
     * Ложь не пишется вовсе — JSON.stringify выбрасывает undefined, и документ
     * настроек не обрастает полями со значением «ничего не произошло».
     */
    exported: value.exported === true ? true : undefined,
    localOnlySeen: value.localOnlySeen === true ? true : undefined,
  };
}
