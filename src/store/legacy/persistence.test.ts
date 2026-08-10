/**
 * Тесты прежнего формата хранения. Только чтение.
 *
 * Проверок сериализации и запаса по лимиту в 4 КБ здесь больше нет: писать в
 * это хранилище нечем, а значит и мериться с лимитом некому. Осталось то, что
 * читает разовый перенос, — разбор компактной формы и слияние двух копий
 * месяца. Уйдёт вместе с самим хранилищем, когда переедут все устройства.
 */

import { describe, expect, it } from 'vitest';

import {
  MONTH_KEY_PATTERN,
  mergeAwards,
  mergeBatteryPayload,
  mergeClicksPayload,
  parseStoredSkills,
} from './persistence';

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
  it('однобуквенные поля разворачиваются в обычные', () => {
    /*
     * Запись задана литералом, а не круговым прогоном через сериализацию: её
     * больше нет, и проверять чтение собственной же записью значило бы сверять
     * код сам с собой. А читать надо ровно то, что лежит на устройствах, —
     * поэтому форма выписана здесь как есть.
     */
    expect(
      parseStoredSkills({
        v: 1,
        s: [{ i: 'g1', t: 'Гитара', c: 3, b: 600, y: 4, d: '2014-06-01' }],
        a: [{ i: 'x1', t: 'Шахматы', c: 0, b: 0, y: 0 }],
        f: '2025-06',
      }),
    ).toEqual({
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
    });
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
