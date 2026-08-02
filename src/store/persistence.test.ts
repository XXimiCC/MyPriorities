import { describe, expect, it } from 'vitest';

import { VALUE_LIMIT } from '../telegram/cloudStorage';
import { MAX_PRIORITIES, type Journal } from '../domain/types';
import {
  exportSnapshot,
  materialize,
  newPriorityId,
  parseSnapshot,
  serializeBatteryMonth,
  serializeClicksMonth,
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
    const ids = Array.from({ length: MAX_PRIORITIES }, (_, i) => newPriorityId([]) + String(i));
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
});

describe('копия данных', () => {
  const settings = {
    version: 1 as const,
    priorities: [{ id: 'ab', title: 'Работа', colorId: 1 }],
    archived: [],
    onboarded: true,
    blockMinutes: 45,
  };
  const journal: Journal = {
    clicks: { '2026-07-31': { ab: 3 } },
    battery: { '2026-07-31': [[540, 2]] },
  };

  it('выгрузка и восстановление дают то же самое', () => {
    const restored = parseSnapshot(exportSnapshot(settings, journal));
    expect(restored.settings.priorities).toEqual(settings.priorities);
    expect(restored.settings.blockMinutes).toBe(45);
    expect(restored.journal).toEqual(journal);
  });

  it('чужой файл отклоняется, а не подменяет данные пустышкой', () => {
    expect(() => parseSnapshot('{"app":"something-else"}')).toThrow(/не от/);
  });

  it('нечитаемый файл отклоняется', () => {
    expect(() => parseSnapshot('не json вовсе')).toThrow(/не читается/);
  });

  it('копия без приоритетов отклоняется', () => {
    const empty = JSON.stringify({ app: 'my-priorities', version: 1, settings: { priorities: [] }, journal: {} });
    expect(() => parseSnapshot(empty)).toThrow(/нет списка/);
  });

  it('мусор внутри копии отбрасывается, а не ломает восстановление', () => {
    const dirty = JSON.stringify({
      app: 'my-priorities',
      version: 1,
      settings,
      journal: {
        clicks: { '2026-07-31': { ab: 2, cd: -5, ef: 'нет' }, 'не-дата': { ab: 9 } },
        battery: { '2026-07-31': [[540, 2], [999, 7], 'мусор'] },
      },
    });
    const restored = parseSnapshot(dirty);
    expect(restored.journal.clicks).toEqual({ '2026-07-31': { ab: 2 } });
    expect(restored.journal.battery).toEqual({ '2026-07-31': [[540, 2]] });
  });
});

describe('идентификаторы', () => {
  it('не выдаёт занятый id', () => {
    const taken = new Set(['ab', 'cd']);
    for (let i = 0; i < 200; i += 1) expect(taken.has(newPriorityId(taken))).toBe(false);
  });

  it('короткий, потому что повторяется в каждом дне истории', () => {
    expect(newPriorityId([])).toHaveLength(2);
  });
});

describe('materialize', () => {
  const known = [
    { id: 'w1', title: 'Работа', colorId: 1 },
    { id: 'f1', title: 'Семья', colorId: 9 },
  ];

  it('переиспользует id по совпадению названия — история не теряется', () => {
    const result = materialize([{ title: 'Работа', colorId: 5 }], known);
    expect(result[0]!.id).toBe('w1');
    // Цвет берётся из набора, а идентичность — из прошлого.
    expect(result[0]!.colorId).toBe(5);
  });

  it('сравнение названий не зависит от регистра и пробелов', () => {
    expect(materialize([{ title: '  работа ', colorId: 0 }], known)[0]!.id).toBe('w1');
  });

  it('новым названиям выдаёт свежие уникальные id', () => {
    const result = materialize(
      [{ title: 'Сон', colorId: 2 }, { title: 'Спорт', colorId: 3 }],
      known,
    );
    const ids = result.map((p) => p.id);
    expect(new Set([...ids, 'w1', 'f1']).size).toBe(4);
  });

  it('обрезает список по лимиту приоритетов', () => {
    const source = Array.from({ length: 15 }, (_, i) => ({ title: `П${i}`, colorId: 0 }));
    expect(materialize(source, [])).toHaveLength(MAX_PRIORITIES);
  });
});
