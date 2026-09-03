import { describe, expect, it } from 'vitest';

import { exportSnapshot, parseSnapshot } from './snapshot';
import { DRAIN_UNKNOWN, type ClicksMap, type Journal } from './types';

const settings = {
  version: 1 as const,
  priorities: [{ id: 'ab', title: 'Работа', colorId: 1 }],
  archived: [],
  onboarded: true,
  blockMinutes: 45,
  modules: { skills: true, achievements: true, insights: true },
};
const journal: Journal = {
  clicks: { '2026-07-31': { ab: 3 } },
  marks: { '2026-07-31': { ab: [null, null, null] } },
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

describe('копия данных', () => {
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

  it('ответ «не знаю» о расходе переживает круговой прогон', () => {
    // Пустая строка на этом месте отсекалась санитайзером как «ответа не было»:
    // ответ доживал до перезагрузки и исчезал, а счётчик ответов расходился
    // со статистикой причин.
    const withDrain: Journal = {
      clicks: {},
      marks: {},
      battery: { '2026-07-31': [[540, 2], [600, 1, DRAIN_UNKNOWN]] },
    };
    const restored = parseSnapshot(exportSnapshot({ ...contents, journal: withDrain }));
    expect(restored.journal.battery['2026-07-31']).toEqual([
      [540, 2],
      [600, 1, DRAIN_UNKNOWN],
    ]);
  });

  it('названный причиной приоритет тоже переживает круговой прогон', () => {
    const withDrain: Journal = {
      clicks: {},
      marks: {},
      battery: { '2026-07-31': [[600, 1, 'ab']] },
    };
    const restored = parseSnapshot(exportSnapshot({ ...contents, journal: withDrain }));
    expect(restored.journal.battery['2026-07-31']).toEqual([[600, 1, 'ab']]);
  });

  it('ответ своими словами переживает круговой прогон', () => {
    const withDrain: Journal = {
      clicks: {},
      marks: {},
      battery: { '2026-07-31': [[600, 1, '!дорога домой']] },
    };
    const restored = parseSnapshot(exportSnapshot({ ...contents, journal: withDrain }));
    expect(restored.journal.battery['2026-07-31']).toEqual([[600, 1, '!дорога домой']]);
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
