/**
 * Тесты формата CloudStorage.
 *
 * Живут вместе с самим форматом и уйдут вместе с ним. Проверки домена —
 * настроек, каталога навыков, копии данных — переезд переживут и лежат рядом
 * со своими модулями.
 */

import { describe, expect, it } from 'vitest';

import { VALUE_LIMIT } from '../../telegram/cloudStorage';
import { newShortId } from '../../domain/settings';
import { MAX_PRIORITIES, type ClicksMap, type Journal } from '../../domain/types';
import { MAX_ARCHIVED_SKILLS, MAX_SKILLS, MAX_SKILL_TITLE, type Skill } from '../../skills/types';
import {
  MONTH_KEY_PATTERN,
  mergeAwards,
  mergeBatteryPayload,
  mergeClicksPayload,
  parseStoredSkills,
  payloadSize,
  serializeBatteryMonth,
  serializeClicksMap,
  serializeClicksMonth,
  serializeSkills,
} from './persistence';

/** Разбор месячного блока не экспортируется — повторяем его через тот же формат. */
function parseMonth(month: string, raw: string): Journal['clicks'] {
  const parsed = JSON.parse(raw) as Record<string, Record<string, number>>;
  const out: Journal['clicks'] = {};
  for (const [day, entry] of Object.entries(parsed)) out[`${month}-${day}`] = entry;
  return out;
}

describe('сериализация месяца', () => {
  it('клики переживают круговой прогон', () => {
    const journal: Journal = {
      clicks: { '2026-07-01': { ab: 4, cd: 2 }, '2026-07-15': { ab: 1 } },
      battery: {},
    };
    const raw = serializeClicksMonth(journal, '2026-07');
    expect(parseMonth('2026-07', raw)).toEqual(journal.clicks);
  });

  it('в блок попадает только свой месяц', () => {
    const journal: Journal = {
      clicks: { '2026-07-31': { ab: 1 }, '2026-08-01': { ab: 9 } },
      battery: {},
    };
    expect(JSON.parse(serializeClicksMonth(journal, '2026-07'))).toEqual({ '31': { ab: 1 } });
  });

  it('нули и пустые дни в хранилище не уезжают', () => {
    const journal: Journal = {
      clicks: { '2026-07-01': { ab: 0 }, '2026-07-02': { ab: 3, cd: 0 } },
      battery: {},
    };
    expect(JSON.parse(serializeClicksMonth(journal, '2026-07'))).toEqual({ '02': { ab: 3 } });
  });

  it('переходы батареи переживают круговой прогон', () => {
    const journal: Journal = {
      clicks: {},
      battery: { '2026-07-04': [[0, 3], [540, 2], [1200, 1]] },
    };
    expect(JSON.parse(serializeBatteryMonth(journal, '2026-07'))).toEqual({
      '04': [[0, 3], [540, 2], [1200, 1]],
    });
  });
});

describe('запас по лимиту CloudStorage', () => {
  it('худший месяц кликов укладывается в 4096 символов', () => {
    // Все десять приоритетов, каждый день месяца, двузначные счётчики —
    // такого в жизни не бывает, но именно этот случай должен помещаться.
    const ids = Array.from({ length: MAX_PRIORITIES }, (_, i) => newShortId([]) + String(i));
    const journal: Journal = { clicks: {}, battery: {} };
    for (let day = 1; day <= 31; day += 1) {
      const key = `2026-07-${String(day).padStart(2, '0')}`;
      journal.clicks[key] = Object.fromEntries(ids.map((id) => [id, 48]));
    }

    const size = serializeClicksMonth(journal, '2026-07').length;
    expect(size).toBeLessThan(VALUE_LIMIT);
  });

  it('худший месяц батареи укладывается в 4096 символов', () => {
    // Двенадцать переключений в день — заметно больше любого реального поведения.
    const journal: Journal = { clicks: {}, battery: {} };
    for (let day = 1; day <= 31; day += 1) {
      const key = `2026-07-${String(day).padStart(2, '0')}`;
      journal.battery[key] = Array.from({ length: 12 }, (_, i) => [i * 120, ((i % 4) + 1) as 1 | 2 | 3 | 4]);
    }

    expect(serializeBatteryMonth(journal, '2026-07').length).toBeLessThan(VALUE_LIMIT);
  });

  it('худший месяц навыков укладывается в 4096 символов', () => {
    // Двенадцать — это и есть MAX_SKILLS, и предел выбран именно по этому тесту:
    // при шестнадцати навыках месяц уже не помещается.
    const ids = Array.from({ length: MAX_SKILLS }, (_, i) => newShortId([]) + String(i));
    const clicks: ClicksMap = {};
    for (let day = 1; day <= 31; day += 1) {
      clicks[`2026-07-${String(day).padStart(2, '0')}`] = Object.fromEntries(
        ids.map((id) => [id, 48]),
      );
    }

    expect(serializeClicksMap(clicks, '2026-07').length).toBeLessThan(VALUE_LIMIT);
  });

  it('худший каталог навыков укладывается в 4096 символов', () => {
    // Все поля заполнены, названия предельной длины, архив полон.
    const skill = (i: number): Skill => ({
      id: `s${i}`,
      title: 'Я'.repeat(MAX_SKILL_TITLE),
      colorId: 9,
      baseMinutes: 900_000,
      carryBlocks: 9999,
      linkedPriorityId: 'ab',
      startedOn: '2004-06-01',
    });

    const size = payloadSize(
      serializeSkills({
        skills: Array.from({ length: MAX_SKILLS }, (_, i) => skill(i)),
        archived: Array.from({ length: MAX_ARCHIVED_SKILLS }, (_, i) => skill(100 + i)),
        foldedThrough: '2025-06',
      }),
    );

    expect(size).toBeLessThan(VALUE_LIMIT);
  });

  it('размер меряется байтами UTF-8, а не длиной строки', () => {
    // Кириллица весит два байта, и мерить длиной означало считать запас вдвое
    // больше настоящего — ровно там, где кириллица и живёт: в названиях.
    const cyrillic = 'Я'.repeat(100);
    expect(cyrillic.length).toBe(100);
    expect(payloadSize(cyrillic)).toBe(200);
    expect(payloadSize('ab')).toBe(2);
  });
});

describe('что считается историей', () => {
  it('месячные блоки кликов, батареи и навыков — история', () => {
    expect(MONTH_KEY_PATTERN.test('mp:p:2026-07')).toBe(true);
    expect(MONTH_KEY_PATTERN.test('mp:b:2026-07')).toBe(true);
    expect(MONTH_KEY_PATTERN.test('mp:k:2026-07')).toBe(true);
  });

  it('каталоги и настройки историей не считаются и сброс истории их не трогает', () => {
    // Если бы mp:k попал под шаблон, «стереть историю» унесло бы и стартовый
    // капитал навыков — часы, которых в кликах никогда не было.
    expect(MONTH_KEY_PATTERN.test('mp:k')).toBe(false);
    expect(MONTH_KEY_PATTERN.test('mp:a')).toBe(false);
    expect(MONTH_KEY_PATTERN.test('mp:s')).toBe(false);
  });
});

describe('компактная форма каталога навыков', () => {
  it('переживает круговой прогон', () => {
    const state = {
      skills: [
        {
          id: 'g1',
          title: 'Гитара',
          colorId: 3,
          baseMinutes: 600,
          carryBlocks: 4,
          startedOn: '2014-06-01',
        },
      ],
      archived: [{ id: 'x1', title: 'Шахматы', colorId: 0, baseMinutes: 0, carryBlocks: 0 }],
      foldedThrough: '2025-06',
    };
    expect(parseStoredSkills(JSON.parse(serializeSkills(state)))).toEqual(state);
  });

  it('битая запись читается как пустой каталог, а не падает', () => {
    expect(parseStoredSkills({ v: 1, s: null, a: 5 })).toEqual({ skills: [], archived: [] });
    expect(parseStoredSkills(null)).toEqual({ skills: [], archived: [] });
  });
});

describe('слияние двух копий месяца', () => {
  const clicks = (value: Record<string, Record<string, number>>): string => JSON.stringify(value);

  it('складывает дни, которые есть только на одной стороне', () => {
    const merged = mergeClicksPayload(
      clicks({ '01': { ab: 2 } }),
      clicks({ '02': { cd: 3 } }),
    );
    expect(JSON.parse(merged!)).toEqual({ '01': { ab: 2 }, '02': { cd: 3 } });
  });

  it('в общей ячейке берёт большее, а не сумму', () => {
    // Сумма удвоила бы то, что оба устройства уже видели после синхронизации.
    // Цена этого выбора — снятый блок возвращается; ради неё и затеян журнал
    // операций, где снятие просто слагаемое со знаком минус.
    const merged = mergeClicksPayload(clicks({ '01': { ab: 4 } }), clicks({ '01': { ab: 6 } }));
    expect(JSON.parse(merged!)).toEqual({ '01': { ab: 6 } });
  });

  it('приоритеты одного дня с разных устройств не теряются', () => {
    const merged = mergeClicksPayload(
      clicks({ '01': { ab: 4 } }),
      clicks({ '01': { cd: 1 } }),
    );
    expect(JSON.parse(merged!)).toEqual({ '01': { ab: 4, cd: 1 } });
  });

  it('сторона с испорченным JSON не затирает целую', () => {
    expect(mergeClicksPayload('{не json', clicks({ '01': { ab: 1 } }))).toBe(
      clicks({ '01': { ab: 1 } }),
    );
    expect(mergeClicksPayload(clicks({ '01': { ab: 1 } }), undefined)).toBe(
      clicks({ '01': { ab: 1 } }),
    );
  });

  it('мусорный номер дня в блок не попадает', () => {
    const merged = mergeClicksPayload(clicks({ '1': { ab: 2 }, '45': { cd: 1 } }), undefined);
    // Односторонний вход возвращается как есть, а вот при слиянии он чистится.
    const both = mergeClicksPayload(clicks({ '1': { ab: 2 } }), clicks({ '02': { cd: 1 } }));
    expect(merged).toBeDefined();
    expect(JSON.parse(both!)).toEqual({ '02': { cd: 1 } });
  });

  it('переходы батареи объединяются по минутам', () => {
    const merged = mergeBatteryPayload(
      JSON.stringify({ '01': [[540, 2]] }),
      JSON.stringify({ '01': [[900, 1]] }),
    );
    expect(JSON.parse(merged!)).toEqual({ '01': [[540, 2], [900, 1]] });
  });

  it('при совпадении минуты выигрывает переход с ответом о расходе', () => {
    const merged = mergeBatteryPayload(
      JSON.stringify({ '01': [[540, 1]] }),
      JSON.stringify({ '01': [[540, 1, 'ab']] }),
    );
    expect(JSON.parse(merged!)).toEqual({ '01': [[540, 1, 'ab']] });
  });
});

describe('слияние достижений', () => {
  it('берёт всё, что есть хоть на одной стороне', () => {
    expect(mergeAwards({ s1: '2026-07-01' }, { h1: '2026-07-02' })).toEqual({
      s1: '2026-07-01',
      h1: '2026-07-02',
    });
  });

  it('при совпадении оставляет более раннюю дату', () => {
    // Выдача необратима: достижение не должно «переполучаться» позже.
    expect(mergeAwards({ s1: '2026-07-09' }, { s1: '2026-07-01' })).toEqual({ s1: '2026-07-01' });
  });
});
