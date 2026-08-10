import { describe, expect, it } from 'vitest';

import type { ClicksMap } from '../domain/types';
import {
  skillBlocksByDay,
  skillBlocksIn,
  skillBlocksOn,
  skillMinutes,
  skillTotals,
  targetOf,
  totalMinutes,
} from './total';
import type { Skill } from './types';

const skill = (patch: Partial<Skill> = {}): Skill => ({
  id: 'g1',
  title: 'Гитара',
  colorId: 0,
  baseMinutes: 0,
  carryBlocks: 0,
  ...patch,
});

const ctx = (patch: { skillClicks?: ClicksMap; clicks?: ClicksMap; blockMinutes?: number } = {}) => ({
  skillClicks: patch.skillClicks ?? {},
  clicks: patch.clicks ?? {},
  blockMinutes: patch.blockMinutes ?? 30,
});

describe('часы навыка', () => {
  it('складывает стартовый капитал, свёрнутые месяцы и блоки истории', () => {
    const minutes = skillMinutes(
      skill({ baseMinutes: 600, carryBlocks: 4 }),
      ctx({ skillClicks: { '2026-07-01': { g1: 2 }, '2026-07-02': { g1: 1 } } }),
    );
    // 600 + (4 + 3) × 30
    expect(minutes).toBe(810);
  });

  it('стартовый капитал ценой блока не переоценивается, а блоки — да', () => {
    const target = skill({ baseMinutes: 600, carryBlocks: 2 });
    const clicks = { skillClicks: { '2026-07-01': { g1: 2 } } };

    expect(skillMinutes(target, ctx({ ...clicks, blockMinutes: 30 }))).toBe(600 + 4 * 30);
    expect(skillMinutes(target, ctx({ ...clicks, blockMinutes: 60 }))).toBe(600 + 4 * 60);
  });

  it('чужие id в журнале не засчитываются', () => {
    const minutes = skillMinutes(skill(), ctx({ skillClicks: { '2026-07-01': { g1: 1, g2: 9 } } }));
    expect(minutes).toBe(30);
  });
});

describe('привязка к приоритету', () => {
  const own: ClicksMap = { '2026-07-01': { g1: 3 } };
  const priority: ClicksMap = { '2026-06-01': { ab: 10 }, '2026-07-01': { ab: 5, cd: 7 } };

  it('добавляет часы приоритета к собственным, а не заменяет их', () => {
    const linked = skill({ linkedPriorityId: 'ab' });
    // Свои 3 блока плюс 15 блоков приоритета.
    expect(skillMinutes(linked, ctx({ skillClicks: own, clicks: priority }))).toBe(18 * 30);
  });

  it('отвязка возвращает ровно то, что было до привязки', () => {
    const before = skillMinutes(skill(), ctx({ skillClicks: own, clicks: priority }));
    const linked = skillMinutes(
      skill({ linkedPriorityId: 'ab' }),
      ctx({ skillClicks: own, clicks: priority }),
    );
    const after = skillMinutes(skill(), ctx({ skillClicks: own, clicks: priority }));

    expect(linked).toBeGreaterThan(before);
    expect(after).toBe(before);
  });

  it('засчитывает историю приоритета целиком, а не с момента привязки', () => {
    // Июньские блоки приоритета попадают в навык так же, как июльские:
    // «Работа» и «Программирование» — это одно и то же время, и оно всё считается.
    const linked = skill({ linkedPriorityId: 'ab' });
    expect(skillMinutes(linked, ctx({ clicks: priority }))).toBe(15 * 30);
  });

  it('часы архивного приоритета продолжают считаться', () => {
    // Приоритет удалён и лежит в архиве, но его журнал никуда не делся.
    const linked = skill({ linkedPriorityId: 'ab' });
    expect(skillMinutes(linked, ctx({ clicks: priority }))).toBeGreaterThan(0);
    expect(targetOf(linked, new Set())).toEqual({ kind: 'skill' });
  });

  it('«плюс» живой привязки уходит приоритету, чтобы время не считалось дважды', () => {
    expect(targetOf(skill({ linkedPriorityId: 'ab' }), new Set(['ab']))).toEqual({
      kind: 'priority',
      id: 'ab',
    });
    expect(targetOf(skill(), new Set(['ab']))).toEqual({ kind: 'skill' });
  });
});

describe('блоки за день', () => {
  it('считает свои и привязанные вместе', () => {
    const linked = skill({ linkedPriorityId: 'ab' });
    const context = ctx({
      skillClicks: { '2026-07-01': { g1: 2 } },
      clicks: { '2026-07-01': { ab: 3 } },
    });
    expect(skillBlocksOn(linked, context, '2026-07-01')).toBe(5);
    expect(skillBlocksOn(linked, context, '2026-07-02')).toBe(0);
  });
});

describe('блоки за период', () => {
  const context = ctx({
    skillClicks: { '2026-07-01': { g1: 2 }, '2026-07-05': { g1: 1 }, '2026-06-20': { g1: 9 } },
    clicks: { '2026-07-05': { ab: 4 } },
  });

  it('складывает только дни окна', () => {
    expect(skillBlocksIn(skill(), context, ['2026-07-01', '2026-07-05'])).toBe(3);
  });

  it('привязанные блоки входят в период наравне со своими', () => {
    const linked = skill({ linkedPriorityId: 'ab' });
    expect(skillBlocksIn(linked, context, ['2026-07-05'])).toBe(5);
  });

  it('стартовый капитал и свёрнутые месяцы в период не попадают', () => {
    // У них нет даты, приписать их к неделе или месяцу нельзя.
    const rich = skill({ baseMinutes: 90_000, carryBlocks: 500 });
    expect(skillBlocksIn(rich, context, ['2026-07-01'])).toBe(2);
  });

  it('пустое окно даёт ноль', () => {
    expect(skillBlocksIn(skill(), context, [])).toBe(0);
  });
});

describe('история по дням', () => {
  const context = ctx({
    skillClicks: { '2026-07-01': { g1: 2 }, '2026-07-03': { g1: 1 } },
    clicks: { '2026-07-02': { ab: 4 } },
  });
  const window = ['2026-07-01', '2026-07-02', '2026-07-03'];

  it('сохраняет порядок дней и оставляет пустые нулями', () => {
    expect(skillBlocksByDay(skill(), context, window)).toEqual([2, 0, 1]);
  });

  it('привязанные блоки попадают в свой день, а не в сумму', () => {
    expect(skillBlocksByDay(skill({ linkedPriorityId: 'ab' }), context, window)).toEqual([2, 4, 1]);
  });

  it('сумма истории совпадает с окном за те же дни', () => {
    const linked = skill({ linkedPriorityId: 'ab' });
    const byDay = skillBlocksByDay(linked, context, window).reduce((sum, n) => sum + n, 0);
    expect(byDay).toBe(skillBlocksIn(linked, context, window));
  });
});

describe('сводка', () => {
  it('ступень берётся из накопленных минут', () => {
    const totals = skillTotals(
      [skill({ id: 'g1', baseMinutes: 100 * 60 }), skill({ id: 'g2', baseMinutes: 0 })],
      ctx(),
    );
    expect(totals[0]!.progress.level.rank).toBe('skilled');
    expect(totals[1]!.progress.level.rank).toBe('none');
  });

  it('сумма по всем навыкам складывается из их минут', () => {
    const totals = skillTotals(
      [skill({ id: 'g1', baseMinutes: 600 }), skill({ id: 'g2', baseMinutes: 900 })],
      ctx(),
    );
    expect(totalMinutes(totals)).toBe(1500);
  });
});
