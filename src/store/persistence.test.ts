import { describe, expect, it } from 'vitest';

import { VALUE_LIMIT } from '../telegram/cloudStorage';
import { MAX_PRIORITIES, type ClicksMap, type Journal } from '../domain/types';
import { MAX_ARCHIVED_SKILLS, MAX_SKILLS, MAX_SKILL_TITLE, type Skill } from '../skills/types';
import {
  MONTH_KEY_PATTERN,
  exportSnapshot,
  materialize,
  newShortId,
  parseSnapshot,
  parseStoredSkills,
  sanitizeSkills,
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

    const size = serializeSkills({
      skills: Array.from({ length: MAX_SKILLS }, (_, i) => skill(i)),
      archived: Array.from({ length: MAX_ARCHIVED_SKILLS }, (_, i) => skill(100 + i)),
      foldedThrough: '2025-06',
    }).length;

    expect(size).toBeLessThan(VALUE_LIMIT);
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

describe('каталог навыков', () => {
  const plain = (id: string, patch: Partial<Skill> = {}): Skill => ({
    id,
    title: `Навык ${id}`,
    colorId: 0,
    baseMinutes: 0,
    carryBlocks: 0,
    ...patch,
  });

  it('переживает круговой прогон через компактную форму хранилища', () => {
    const state = {
      skills: [plain('g1', { title: 'Гитара', colorId: 3, baseMinutes: 600, carryBlocks: 4, startedOn: '2014-06-01' })],
      archived: [plain('x1', { title: 'Шахматы' })],
      foldedThrough: '2025-06',
    };
    expect(parseStoredSkills(JSON.parse(serializeSkills(state)))).toEqual(state);
  });

  it('в копии данных навыки лежат в читаемом виде, а не в компактном', () => {
    // Компактные однобуквенные поля — приём хранилища, а не формат файла:
    // копию человек открывает и читает глазами.
    const state = { skills: [plain('g1', { title: 'Гитара' })], archived: [] };
    expect(sanitizeSkills(state)).toEqual(state);
  });

  it('один приоритет не может кормить два навыка', () => {
    // Иначе одни и те же часы засчитались бы дважды.
    const state = sanitizeSkills({
      skills: [plain('g1', { linkedPriorityId: 'ab' }), plain('g2', { linkedPriorityId: 'ab' })],
      archived: [],
    });
    expect(state.skills[0]!.linkedPriorityId).toBe('ab');
    expect(state.skills[1]!.linkedPriorityId).toBeUndefined();
  });

  it('дубли по id отбрасываются', () => {
    const state = sanitizeSkills({ skills: [plain('g1'), plain('g1')], archived: [] });
    expect(state.skills).toHaveLength(1);
  });

  it('навык не может быть одновременно активным и архивным', () => {
    const state = sanitizeSkills({ skills: [plain('g1')], archived: [plain('g1')] });
    expect(state.skills).toHaveLength(1);
    expect(state.archived).toHaveLength(0);
  });

  it('режет список по потолкам', () => {
    const state = sanitizeSkills({
      skills: Array.from({ length: 40 }, (_, i) => plain(`s${i}`)),
      archived: Array.from({ length: 40 }, (_, i) => plain(`a${i}`)),
    });
    expect(state.skills).toHaveLength(MAX_SKILLS);
    expect(state.archived).toHaveLength(MAX_ARCHIVED_SKILLS);
  });

  it('у архивных навыков привязка снимается — они ничего не считают', () => {
    const state = sanitizeSkills({ skills: [], archived: [plain('x1', { linkedPriorityId: 'ab' })] });
    expect(state.archived[0]!.linkedPriorityId).toBeUndefined();
  });

  it('пустое и битое читается как пустой каталог, а не падает', () => {
    expect(sanitizeSkills(undefined)).toEqual({ skills: [], archived: [] });
    expect(sanitizeSkills('строка')).toEqual({ skills: [], archived: [] });
    expect(sanitizeSkills({ skills: 'не массив', archived: null })).toEqual({ skills: [], archived: [] });
    expect(parseStoredSkills({ v: 1, s: null, a: 5 })).toEqual({ skills: [], archived: [] });
  });
});

describe('копия данных', () => {
  const settings = {
    version: 1 as const,
    priorities: [{ id: 'ab', title: 'Работа', colorId: 1 }],
    archived: [],
    onboarded: true,
    blockMinutes: 45,
    modules: { skills: true, achievements: true },
  };
  const journal: Journal = {
    clicks: { '2026-07-31': { ab: 3 } },
    battery: { '2026-07-31': [[540, 2]] },
  };
  const skills = {
    skills: [
      {
        id: 'g1',
        title: 'Гитара',
        colorId: 3,
        baseMinutes: 90_000,
        carryBlocks: 12,
        linkedPriorityId: 'ab',
        startedOn: '2014-06-01',
      },
    ],
    archived: [],
    foldedThrough: '2025-06',
  };
  const skillClicks: ClicksMap = { '2026-07-31': { g1: 2 } };
  const awards = { s1: '2026-07-20', m2: '2026-07-25' };
  const contents = { settings, journal, skills, skillClicks, awards };

  it('выгрузка и восстановление дают то же самое', () => {
    const restored = parseSnapshot(exportSnapshot(contents));
    expect(restored.settings.priorities).toEqual(settings.priorities);
    expect(restored.settings.blockMinutes).toBe(45);
    expect(restored.journal).toEqual(journal);
  });

  it('навыки и достижения переживают круговой прогон', () => {
    const restored = parseSnapshot(exportSnapshot(contents));
    expect(restored.skills).toEqual(skills);
    expect(restored.skillClicks).toEqual(skillClicks);
    expect(restored.awards).toEqual(awards);
  });

  it('копия, сделанная до навыков, читается без ошибки', () => {
    // Файл первой версии — ровно то, что выгружали до появления модулей.
    const old = JSON.stringify({
      app: 'my-priorities',
      version: 1,
      exportedAt: '2026-07-01T00:00:00.000Z',
      settings,
      journal,
    });
    const restored = parseSnapshot(old);
    expect(restored.journal).toEqual(journal);
    expect(restored.skills).toEqual({ skills: [], archived: [] });
    expect(restored.skillClicks).toEqual({});
    expect(restored.awards).toEqual({});
  });

  it('мусор в навыках и достижениях отбрасывается', () => {
    const dirty = JSON.stringify({
      app: 'my-priorities',
      version: 2,
      settings,
      journal,
      skills: {
        skills: [
          { id: 'g1', title: 'Гитара', colorId: 0, baseMinutes: -5, carryBlocks: 'нет' },
          { title: 'без id' },
        ],
        archived: [],
      },
      skillClicks: { 'не-дата': { g1: 4 }, '2026-07-31': { g1: 0, g2: 3 } },
      awards: { s1: '2026-07-20', s2: 'вчера', s3: 42 },
    });
    const restored = parseSnapshot(dirty);
    expect(restored.skills.skills).toHaveLength(1);
    expect(restored.skills.skills[0]!.baseMinutes).toBe(0);
    expect(restored.skills.skills[0]!.carryBlocks).toBe(0);
    expect(restored.skillClicks).toEqual({ '2026-07-31': { g2: 3 } });
    expect(restored.awards).toEqual({ s1: '2026-07-20' });
  });

  it('чужой файл отклоняется, а не подменяет данные пустышкой', () => {
    expect(() => parseSnapshot('{"app":"something-else"}')).toThrow('import.foreignFile');
  });

  it('нечитаемый файл отклоняется', () => {
    expect(() => parseSnapshot('не json вовсе')).toThrow('import.notJson');
  });

  it('копия без приоритетов отклоняется', () => {
    const empty = JSON.stringify({ app: 'my-priorities', version: 1, settings: { priorities: [] }, journal: {} });
    expect(() => parseSnapshot(empty)).toThrow('import.noPriorities');
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
    for (let i = 0; i < 200; i += 1) expect(taken.has(newShortId(taken))).toBe(false);
  });

  it('короткий, потому что повторяется в каждом дне истории', () => {
    expect(newShortId([])).toHaveLength(2);
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
