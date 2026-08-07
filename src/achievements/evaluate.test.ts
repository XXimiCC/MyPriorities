import { describe, expect, it } from 'vitest';

import { DEFAULT_MODULES, type Journal, type Settings } from '../domain/types';
import { progressOf } from '../skills/levels';
import type { SkillTotal } from '../skills/total';
import { derive } from './derive';
import { awardProgress, evaluate, stripAuto } from './evaluate';
import type { AchievementContext } from './types';

const NOW = new Date(2026, 6, 31, 12, 0); // 31 июля 2026
const TODAY = '2026-07-31';

const settings: Settings = {
  version: 1,
  priorities: [
    { id: 'ab', title: 'Работа', colorId: 0 },
    { id: 'cd', title: 'Семья', colorId: 1 },
  ],
  archived: [],
  onboarded: true,
  blockMinutes: 30,
  modules: DEFAULT_MODULES,
};

const skillTotal = (minutes: number, startedOn?: string): SkillTotal => ({
  skill: {
    id: 'g1',
    title: 'Гитара',
    colorId: 0,
    baseMinutes: minutes,
    carryBlocks: 0,
    ...(startedOn ? { startedOn } : {}),
  },
  blocks: 0,
  minutes,
  progress: progressOf(minutes),
});

function contextOf(journal: Journal, skills: SkillTotal[] = []): AchievementContext {
  return { settings, journal, skills, derived: derive(settings, journal, NOW), now: NOW };
}

const options = { skillsEnabled: true, today: TODAY };

/** Журнал с заданным числом блоков в один день. */
function blocksOn(day: string, counts: Record<string, number>): Journal {
  return { clicks: { [day]: counts }, battery: {} };
}

describe('выдача', () => {
  it('на пустых данных ничего не выдаётся', () => {
    const result = evaluate({}, contextOf({ clicks: {}, battery: {} }), options);
    expect(result.fresh).toEqual([]);
    expect(result.awards).toEqual({});
  });

  it('неприменимое условие не считается выполненным', () => {
    // «Без крена» требует пяти приоритетов; при двух его нельзя ни выполнить,
    // ни провалить — и выдавать его на пустом журнале тем более нельзя.
    const result = evaluate({}, contextOf(blocksOn(TODAY, { ab: 1 })), options);
    expect(result.awards.b2).toBeUndefined();
    expect(result.awards.b3).toBeUndefined();
    expect(result.awards.b4).toBeUndefined();
  });

  it('первый блок открывает первое достижение', () => {
    const result = evaluate({}, contextOf(blocksOn(TODAY, { ab: 1 })), options);
    expect(result.fresh).toContain('s1');
    expect(result.awards.s1).toBe(TODAY);
  });

  it('порог соблюдается точно', () => {
    // 100 часов при цене блока в 30 минут — это ровно 200 блоков.
    const under = evaluate({}, contextOf(spread(199)), options);
    const exact = evaluate({}, contextOf(spread(200)), options);
    expect(under.awards.h3).toBeUndefined();
    expect(exact.awards.h3).toBe(TODAY);
  });

  it('повторный прогон ничего не выдаёт заново и не меняет дату', () => {
    const ctx = contextOf(blocksOn(TODAY, { ab: 1 }));
    const first = evaluate({}, ctx, options);
    const second = evaluate(first.awards, ctx, { ...options, today: '2026-08-15' });

    expect(second.fresh).toEqual([]);
    expect(second.awards.s1).toBe(TODAY);
    // Ссылка та же: на неё завязан наблюдатель, лишняя запись в хранилище не нужна.
    expect(second.awards).toBe(first.awards);
  });

  it('выданное не отбирается, когда условие снова стало ложным', () => {
    // Иначе «доля лидера за 30 дней» мигала бы вместе со скользящим окном.
    const earned = evaluate({}, contextOf(blocksOn(TODAY, { ab: 1 })), options);
    const empty = evaluate(earned.awards, contextOf({ clicks: {}, battery: {} }), options);
    expect(empty.awards.s1).toBe(TODAY);
  });

  it('выключенный модуль навыков не раздаёт достижения за навыки', () => {
    const ctx = contextOf(blocksOn(TODAY, { ab: 1 }), [skillTotal(200 * 60)]);
    const off = evaluate({}, ctx, { ...options, skillsEnabled: false });
    const on = evaluate({}, ctx, options);

    expect(off.awards.n1).toBeUndefined();
    expect(on.awards.n1).toBe(TODAY);
    expect(on.awards.n5).toBe(TODAY);
  });

  it('часы навыка считаются по накопленному, а не по кликам', () => {
    const ctx = contextOf({ clicks: {}, battery: {} }, [skillTotal(1000 * 60)]);
    const result = evaluate({}, ctx, options);
    expect(result.awards.n6).toBe(TODAY);
    expect(result.awards.n7).toBeUndefined();
  });

  it('возраст навыка считается от переданного «сейчас»', () => {
    const old = contextOf({ clicks: {}, battery: {} }, [skillTotal(60, '2010-01-01')]);
    const fresh = contextOf({ clicks: {}, battery: {} }, [skillTotal(60, '2024-01-01')]);
    expect(evaluate({}, old, options).awards.nd).toBe(TODAY);
    expect(evaluate({}, fresh, options).awards.nd).toBeUndefined();
  });
});

describe('снятие автоматических', () => {
  const awards = { s1: '2026-07-01', h1: '2026-07-02', r1: '2026-07-03', m2: '2026-07-04' };

  it('снимает выведенные из данных и оставляет факты', () => {
    const left = stripAuto(awards);
    expect(left.s1).toBeUndefined();
    expect(left.h1).toBeUndefined();
    // Ритуал приложения и отметка о жизни — это события, а не выводы из журнала.
    expect(left.r1).toBe('2026-07-03');
    expect(left.m2).toBe('2026-07-04');
  });

  it('незнакомые идентификаторы сохраняются', () => {
    // Достижение из будущей версии прилетело из облака: стирать его нельзя.
    expect(stripAuto({ zz: '2026-07-01' }).zz).toBe('2026-07-01');
  });
});

describe('счётчик открытого', () => {
  it('при выключенных навыках их достижения не входят в знаменатель', () => {
    const all = awardProgress({}, true);
    const withoutSkills = awardProgress({}, false);
    expect(withoutSkills.total).toBeLessThan(all.total);
  });

  it('считает открытые', () => {
    expect(awardProgress({ s1: TODAY, m1: TODAY }, true).done).toBe(2);
  });
});

/** Журнал, в котором ровно n блоков, размазанных по разным дням. */
function spread(n: number): Journal {
  const clicks: Journal['clicks'] = {};
  let left = n;
  let day = 1;
  while (left > 0 && day <= 31) {
    const take = Math.min(left, 10);
    clicks[`2026-07-${String(day).padStart(2, '0')}`] = { ab: take };
    left -= take;
    day += 1;
  }
  return { clicks, battery: {} };
}
