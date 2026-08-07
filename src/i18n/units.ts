/**
 * Подстановка форм множественного числа в шаблоны строк.
 *
 * Шаблоны пишутся как «{n} {nUnit} подряд», а таблица говорит, каким словом
 * склоняется каждое число. Таблица привязана к шаблону, а не к тому, кто его
 * использует: у всех семи «серий» подряд она одна.
 *
 * Живёт в i18n, а не рядом с достижениями, потому что тем же приёмом
 * пользуются наблюдения, а держать две одинаковые таблицы в разных модулях
 * означает однажды поправить только одну из них.
 */

import { plural, t, type PluralKey, type Params, type StringKey } from './index';

/** Имя подстановки в шаблоне → слово, которым она склоняется. */
export type UnitMap = Record<string, PluralKey>;

export type UnitTable = Partial<Record<StringKey, UnitMap>>;

/**
 * Строка по ключу, где рядом с каждым числом из таблицы появляется его форма.
 * Форма кладётся в «имяUnit»: для числа `{n}` шаблон пишет `{n} {nUnit}`.
 */
export function fillUnits(table: UnitTable, key: StringKey, params?: Params): string {
  const filled: Params = { ...params };
  const units = table[key];

  if (units) {
    for (const [name, pluralKey] of Object.entries(units)) {
      const value = filled[name];
      // Нечисловое пропускаем молча: склонять по строке нечего.
      if (typeof value === 'number') filled[`${name}Unit`] = plural(pluralKey, value);
    }
  }
  return t(key, filled);
}
