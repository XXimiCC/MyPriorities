/**
 * Заслон демо для языка.
 *
 * Единственное место приложения, где выбор пишется мимо подменённого хранилища
 * (store/local/db.ts): язык нужен до первой отрисовки. Значит и обещание «демо
 * не оставляет следов на устройстве» держится здесь отдельным флагом.
 *
 * Печать необратима внутри сеанса, поэтому проверки идут по порядку и в своём
 * файле: vitest даёт каждому файлу свой реестр модулей.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { readLanguage, saveLanguage, sealLanguage } from './language';

/** В ноде localStorage нет, а модуль обращается к нему по голому имени. */
beforeAll(() => {
  const box = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => box.get(key) ?? null,
      setItem: (key: string, value: string) => void box.set(key, value),
      removeItem: (key: string) => void box.delete(key),
    },
  });
});

describe('выбранный язык', () => {
  it('обычно записывается и читается обратно', () => {
    saveLanguage('en');
    expect(readLanguage()).toBe('en');
  });

  it('после печати запись не проходит, а прежний выбор остаётся цел', () => {
    sealLanguage();
    saveLanguage('ru');
    // Ровно то, ради чего заслон и нужен: гость переключил язык в демо, а на
    // устройстве владельца остался тот, что был до его прихода.
    expect(readLanguage()).toBe('en');
  });

  it('чтение печатью не гасится: язык владельца по-прежнему виден', () => {
    expect(readLanguage()).toBe('en');
  });
});
