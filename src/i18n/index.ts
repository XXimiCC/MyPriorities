/**
 * Строки интерфейса.
 *
 * Русская локаль — эталон: типы ключей выведены из неё, поэтому пропущенный
 * ключ в новом переводе будет ошибкой компиляции, а не пустотой на экране.
 *
 * Чтобы добавить английский, нужен ровно один файл `en.ts` с теми же ключами,
 * своими формами множественного числа и своим правилом выбора формы — их две,
 * а не три, и это единственное, что здесь по-настоящему отличается между языками.
 */

import { ruPluralIndex, ruPlurals, ruStrings } from './ru';

export type StringKey = keyof typeof ruStrings;
export type PluralKey = keyof typeof ruPlurals;

export interface Locale {
  code: string;
  strings: Record<StringKey, string>;
  plurals: Record<PluralKey, readonly string[]>;
  pluralIndex(n: number): number;
}

const RU: Locale = {
  code: 'ru',
  strings: ruStrings,
  plurals: ruPlurals,
  pluralIndex: ruPluralIndex,
};

const LOCALES: Record<string, Locale> = { ru: RU };

function pickLocale(): Locale {
  const code =
    typeof window === 'undefined'
      ? undefined
      : window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  return LOCALES[String(code).slice(0, 2)] ?? RU;
}

let active = pickLocale();

/** Только для тестов и будущего переключателя языка. */
export function setLocale(code: string): void {
  active = LOCALES[code] ?? RU;
}

export function currentLocale(): string {
  return active.code;
}

export type Params = Record<string, string | number>;

function fill(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** Строка по ключу с подстановками вида {имя}. */
export function t(key: StringKey, params?: Params): string {
  return fill(active.strings[key] ?? key, params);
}

/** Форма слова по числу — без самого числа: «блока». */
export function plural(key: PluralKey, n: number): string {
  const forms = active.plurals[key];
  return forms[active.pluralIndex(n)] ?? forms[forms.length - 1] ?? '';
}

/** Число вместе с формой: «3 блока». */
export function count(key: PluralKey, n: number): string {
  return `${n} ${plural(key, n)}`;
}
