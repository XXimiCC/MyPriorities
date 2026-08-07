/*
 * Подписи для локаторов — из настоящего src/i18n/ru.ts, а не из копии.
 *
 * Смысл ровно один: если строку в приложении переименуют, скрипт упадёт на
 * отсутствующем ключе, а не снимет молча не тот экран. Копия строк здесь была бы
 * вторым источником правды, который расходится с первым и никого об этом не
 * предупреждает.
 *
 * ru.ts не имеет ни одного импорта (проверено), поэтому Node читает его напрямую:
 * начиная с 22.18 стрипание типов включено по умолчанию, а `as const` — это тип.
 */

import { ruStrings, ruPluralIndex, ruPlurals } from '../../src/i18n/ru.ts';

/** Строка по ключу. Неизвестный ключ — ошибка сразу, а не пустой локатор потом. */
export function s(key) {
  const value = ruStrings[key];
  if (value === undefined) throw new Error(`Нет строки «${key}» в ru.ts`);
  return value;
}

/** Подставляет {имя}, как это делает t() в приложении. */
export function fmt(key, params = {}) {
  return s(key).replace(/\{(\w+)\}/g, (whole, name) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Нет подстановки «${name}» для «${key}»`);
    return String(value);
  });
}

/** Склонение по числу — те же три формы, что в приложении. */
export function plural(word, n) {
  const forms = ruPlurals[word];
  if (!forms) throw new Error(`Нет слова «${word}» в ruPlurals`);
  return forms[ruPluralIndex(n)];
}

export { ruStrings };
