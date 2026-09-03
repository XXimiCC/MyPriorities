/**
 * Две локали не разъехались.
 *
 * Типы уже требуют, чтобы каждый ключ русского словаря был в английском:
 * `Record<StringKey, string>` не соберётся без единственного пропущенного.
 * Чего типы не ловят — три вещи, и все три здесь:
 *
 *   осиротевший ключ    структурная типизация пропускает лишнее, и строка,
 *                       пережившая своё переименование, живёт в переводе
 *                       годами, никого не смущая;
 *   подстановки         `{title}`, потерянный при переводе, даёт не ошибку,
 *                       а фразу с дырой посреди экрана;
 *   формы числа         длину массива задаёт локаль, и правило выбора формы
 *                       может указать за его конец.
 */

import { describe, expect, it } from 'vitest';

import { MAX_SKILLS } from '../skills/types';
import { enFormats, enPluralIndex, enPlurals, enStrings } from './en';
import { plural, setLocale, t } from './index';
import { ruFormats, ruPluralIndex, ruPlurals, ruStrings } from './ru';

const LOCALES = [
  { code: 'ru', strings: ruStrings, plurals: ruPlurals, index: ruPluralIndex, formats: ruFormats, forms: 3 },
  { code: 'en', strings: enStrings, plurals: enPlurals, index: enPluralIndex, formats: enFormats, forms: 2 },
];

/** Имена подстановок вида {имя} — в том порядке, в каком они встретились. */
function slots(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!);
}

describe('словари', () => {
  it('набор ключей совпадает', () => {
    expect(Object.keys(enStrings).sort()).toEqual(Object.keys(ruStrings).sort());
  });

  it('подстановки не потерялись при переводе', () => {
    const broken: string[] = [];

    for (const [key, ru] of Object.entries(ruStrings)) {
      const en = enStrings[key as keyof typeof enStrings];
      // Порядок слов между языками разный, набор — нет.
      const expected = [...new Set(slots(ru))].sort();
      const actual = [...new Set(slots(en))].sort();
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        broken.push(`${key}: ожидались ${expected.join(', ') || '—'}, есть ${actual.join(', ') || '—'}`);
      }
    }

    expect(broken).toEqual([]);
  });

  it('набор склоняемых слов совпадает', () => {
    expect(Object.keys(enPlurals).sort()).toEqual(Object.keys(ruPlurals).sort());
  });
});

/*
 * Подпись на кнопке добавления, когда навыки кончились.
 *
 * Шаблон уже один раз отстал от кода: «Максимум {max} навыков» писался под
 * предел в 12, где форма совпадала, и пережил рост предела до 24 — на экране
 * стояло «Максимум 24 навыков». Отсюда и проверка: форму даёт plural(), а не
 * автор строки, и вписать слово в шаблон обратно значит уронить этот тест.
 */
describe('предел навыков', () => {
  /** Ровно то, что подставляет SkillsScreen. */
  const limit = (n: number): string => t('skills.limit', { max: n, maxUnit: plural('skill', n) });

  it('по-русски форма выбирается по числу', () => {
    setLocale('ru');

    // Сегодняшний предел и две другие формы: если MAX_SKILLS переедет на 21
    // или 12, подпись обязана перестроиться сама.
    expect(limit(MAX_SKILLS), 'сегодняшний MAX_SKILLS').toBe('Максимум 24 навыка');
    expect(limit(21)).toBe('Максимум 21 навык');
    expect(limit(12)).toBe('Максимум 12 навыков');
  });

  it('по-английски строка осталась верной', () => {
    setLocale('en');

    expect(limit(MAX_SKILLS)).toBe('Up to 24 skills');
    expect(limit(1)).toBe('Up to 1 skill');

    // Дальше идут локальные проверки, а эталон в тестах — русский.
    setLocale('ru');
  });
});

describe.each(LOCALES)('локаль $code', ({ plurals, index, formats, forms }) => {
  it(`у каждого слова по ${forms} формы`, () => {
    for (const [word, list] of Object.entries(plurals)) {
      expect(list.length, word).toBe(forms);
    }
  });

  it('правило выбора формы не указывает за конец списка', () => {
    // Одиннадцать и двадцать один — те самые числа, на которых ломается
    // наивное «n === 1 ? 0 : 1», перенесённое из английского в русский.
    for (const n of [0, 1, 2, 4, 5, 11, 14, 21, 101, 1000]) {
      const picked = index(n);
      expect(Number.isInteger(picked), `${n}`).toBe(true);
      expect(picked, `${n}`).toBeGreaterThanOrEqual(0);
      expect(picked, `${n}`).toBeLessThan(forms);
    }
  });

  it('в таблице дат двенадцать месяцев и семь дней недели', () => {
    expect(formats.months.length).toBe(12);
    expect(formats.weekdays.length).toBe(7);
  });
});
