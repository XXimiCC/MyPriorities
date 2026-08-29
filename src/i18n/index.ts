/**
 * Строки интерфейса.
 *
 * Русская локаль — эталон: типы ключей выведены из неё, поэтому пропущенный
 * ключ в новом переводе будет ошибкой компиляции, а не пустотой на экране.
 *
 * Локаль — это один файл: те же ключи, свои формы множественного числа со своим
 * правилом выбора формы (в русском их три, в английском две) и свои таблицы дат
 * и чисел. Ничего больше между языками не отличается.
 */

import { readLanguage, saveLanguage } from '../platform/language';
import { enFormats, enPluralIndex, enPlurals, enStrings } from './en';
import { ruFormats, ruPluralIndex, ruPlurals, ruStrings } from './ru';

export type StringKey = keyof typeof ruStrings;
export type PluralKey = keyof typeof ruPlurals;

/** Даты и числа: то, что живёт не в словаре. Читается из domain/date.ts. */
export interface LocaleFormats {
  months: readonly string[];
  weekdays: readonly string[];
  hour: string;
  minute: string;
  /** Между числом и единицей: «3 ч», но «3h». */
  gap: string;
  decimal: string;
  numberLocale: string;
  dayMonth(day: number, month: string): string;
}

export interface Locale {
  code: string;
  /** Название на себе самом: «English» узнают и те, кто по-английски не читает. */
  name: string;
  strings: Record<StringKey, string>;
  plurals: Record<PluralKey, readonly string[]>;
  pluralIndex(n: number): number;
  formats: LocaleFormats;
}

const RU: Locale = {
  code: 'ru',
  name: 'Русский',
  strings: ruStrings,
  plurals: ruPlurals,
  pluralIndex: ruPluralIndex,
  formats: ruFormats,
};

const EN: Locale = {
  code: 'en',
  name: 'English',
  strings: enStrings,
  plurals: enPlurals,
  pluralIndex: enPluralIndex,
  formats: enFormats,
};

const LOCALES: Record<string, Locale> = { ru: RU, en: EN };

/** Что показать в переключателе. Порядок — порядок объявления. */
export const LANGUAGES: ReadonlyArray<{ code: string; name: string }> = Object.values(LOCALES).map(
  ({ code, name }) => ({ code, name }),
);

/** Прибить язык снаружи: `?lang=en`. Фрейм лендинга, съёмка, ручная проверка. */
const PARAM = 'lang';

function known(code: string | null | undefined): Locale | undefined {
  return code ? LOCALES[code.slice(0, 2).toLowerCase()] : undefined;
}

/*
 * Порядок — от самого явного к самому косвенному, и побеждает первый ЗНАКОМЫЙ
 * язык. Незнакомый код не роняет в русский, а пропускается: у человека с
 * `language_code: 'de'` браузер вполне может стоять английским.
 *
 *   ?lang=    единственный рычаг снаружи. Выше сохранённого выбора намеренно:
 *             иначе фрейм английского лендинга открывался бы по-русски у
 *             любого, кто однажды заходил в приложение. Чтобы параметр не
 *             отменял нажатую кнопку навсегда, chooseLanguage() его вычищает.
 *   выбор     то, что человек нажал в настройках. Живёт на устройстве.
 *   Telegram  внутри мини-аппа язык клиента и есть язык человека.
 *   navigator когда Telegram молчит — то есть в обычном браузере.
 *
 * Если не совпало ничего, язык английский, а не русский. Приложение по
 * умолчанию международное; на русский попадают те, кто на нём и читает.
 *
 * Проверка на window стоит первой и не только ради браузера: этот модуль
 * импортируют загрузчики данных документации, которые собираются в ноде, и все
 * тесты. Там эталон — русский: из него выводятся типы, на нём написаны
 * ожидания тестов и локаторы съёмки.
 */
function pickLocale(): Locale {
  if (typeof window === 'undefined') return RU;
  const url = new URLSearchParams(window.location.search);
  return (
    known(url.get(PARAM)) ??
    known(readLanguage()) ??
    known(window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code) ??
    known(navigator.language) ??
    EN
  );
}

let active = pickLocale();

const listeners = new Set<() => void>();

/** Подписка для React: см. i18n/useLocale.ts. */
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Манифест на каждый язык: имя приложения под иконкой берётся из него, а не из
 * разметки, и переводу не поддаётся иначе как вторым файлом. Оба лежат в
 * `public/` — Vite их не обрабатывает, поэтому имена здесь буквальные.
 */
const MANIFESTS: Record<string, string> = {
  ru: 'manifest.ru.webmanifest',
  en: 'manifest.webmanifest',
};

function setMeta(name: string, content: string): void {
  document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.setAttribute('content', content);
}

/*
 * `<html lang>` — не украшение: от него зависят перенос слов, экранный диктор и
 * подстановка шрифта. Живёт здесь, а не в main.tsx, потому что мест смены языка
 * два — запуск и кнопка, — а забыть одно из них вопрос времени.
 *
 * Рядом — всё, что читает не человек, а система: заголовок вкладки, описание и
 * две подписи под иконкой на домашнем экране (apple-mobile-web-app-title у iOS,
 * short_name манифеста у всех остальных). В разметке они зашиты по-русски и
 * сами не обновятся, а язык по умолчанию теперь английский — без этого человек,
 * читающий по-английски, добавлял на «Домой» иконку с подписью «Приоритеты».
 */
function applyLang(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = active.code;

  document.title = t('app.title');
  setMeta('description', t('meta.description'));
  setMeta('apple-mobile-web-app-title', t('meta.short'));

  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  // Адрес считается от baseURI, а не пишется абсолютным: то же обещание base: './',
  // что и у регистрации воркера в main.tsx.
  if (manifest) {
    manifest.href = new URL(MANIFESTS[active.code] ?? MANIFESTS.en!, document.baseURI).href;
  }
}

applyLang();

/** Сменить активную локаль. Ничего не запоминает — см. chooseLanguage. */
export function setLocale(code: string): void {
  const next = LOCALES[code];
  if (!next || next === active) return;
  active = next;
  applyLang();
  for (const listener of listeners) listener();
}

/**
 * Выбор человека.
 *
 * `?lang=` снимается вместе с записью: параметр стоит выше сохранённого выбора,
 * и оставить его — значит на каждой перезагрузке отменять то, что только что
 * нажали. replaceState, а не assign: перезагрузка здесь ни к чему.
 */
export function chooseLanguage(code: string): void {
  if (!LOCALES[code]) return;
  saveLanguage(code);

  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    if (url.searchParams.has(PARAM)) {
      url.searchParams.delete(PARAM);
      window.history.replaceState(null, '', url.toString());
    }
  }

  setLocale(code);
}

export function currentLocale(): string {
  return active.code;
}

/** Таблицы дат и чисел активного языка. Зовётся из domain/date.ts. */
export function formats(): LocaleFormats {
  return active.formats;
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
