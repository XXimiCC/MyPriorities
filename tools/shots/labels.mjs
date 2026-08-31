/*
 * Подписи для локаторов — из настоящих src/i18n/ru.ts и en.ts, а не из копии.
 *
 * Смысл ровно один: если строку в приложении переименуют, скрипт упадёт на
 * отсутствующем ключе, а не снимет молча не тот экран. Копия строк здесь была бы
 * вторым источником правды, который расходится с первым и никого об этом не
 * предупреждает.
 *
 * Файлы локалей не имеют ни одного импорта (сторожит tools/deps.test.ts),
 * поэтому Node читает их напрямую: начиная с 22.18 стрипание типов включено по
 * умолчанию, а `as const` — это тип.
 */

import { ruStrings, ruPluralIndex, ruPlurals } from '../../src/i18n/ru.ts';
import { enStrings } from '../../src/i18n/en.ts';

/**
 * Набор подписей одного языка: те же s() и fmt(), но из своего словаря.
 *
 * Прогон, снимающий приложение с `?lang=en`, обязан искать английские строки:
 * русский локатор в английском интерфейсе не найдётся и уронит съёмку по
 * таймауту через двадцать секунд.
 */
function bag(lang, strings) {
  /** Строка по ключу. Неизвестный ключ — ошибка сразу, а не пустой локатор потом. */
  const s = (key) => {
    const value = strings[key];
    if (value === undefined) throw new Error(`Нет строки «${key}» в ${lang}.ts`);
    return value;
  };

  /** Подставляет {имя}, как это делает t() в приложении. */
  const fmt = (key, params = {}) =>
    s(key).replace(/\{(\w+)\}/g, (whole, name) => {
      const value = params[name];
      if (value === undefined) throw new Error(`Нет подстановки «${name}» для «${key}»`);
      return String(value);
    });

  return { s, fmt };
}

export const ru = bag('ru', ruStrings);
export const en = bag('en', enStrings);

/*
 * Умолчание — русский: русских прогонов подавляющее большинство, и call-site
 * без языка читается легче, чем ru.s('tab.charge') в каждой строке манифеста.
 */
export const { s, fmt } = ru;

/** Склонение по числу — те же три формы, что в приложении. */
export function plural(word, n) {
  const forms = ruPlurals[word];
  if (!forms) throw new Error(`Нет слова «${word}» в ruPlurals`);
  return forms[ruPluralIndex(n)];
}

export { ruStrings };
