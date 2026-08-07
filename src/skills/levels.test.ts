import { describe, expect, it } from 'vitest';

import { LEVELS, STEPS_PER_RANK, levelOf, progressOf, type RankId } from './levels';

const h = (hours: number): number => hours * 60;

describe('устройство лестницы', () => {
  it('семнадцать ступеней: не начато плюс четыре ранга по четыре', () => {
    expect(LEVELS).toHaveLength(1 + 4 * STEPS_PER_RANK);
  });

  it('в каждом настоящем ранге ровно четыре ступени с номерами I..IV', () => {
    for (const rank of ['novice', 'skilled', 'expert', 'master'] as RankId[]) {
      const steps = LEVELS.filter((level) => level.rank === rank).map((level) => level.step);
      expect(steps).toEqual([1, 2, 3, 4]);
    }
    expect(LEVELS.filter((level) => level.rank === 'none').map((l) => l.step)).toEqual([0]);
  });

  it('пороги строго возрастают — защита от опечатки в таблице', () => {
    for (let i = 1; i < LEVELS.length; i += 1) {
      expect(LEVELS[i]!.hours).toBeGreaterThan(LEVELS[i - 1]!.hours);
    }
  });

  it('мастер начинается ровно с пяти тысяч часов', () => {
    const master = LEVELS.find((level) => level.rank === 'master');
    expect(master?.hours).toBe(5000);
  });

  it('индексы совпадают с положением в массиве', () => {
    LEVELS.forEach((level, index) => expect(level.index).toBe(index));
  });
});

describe('levelOf', () => {
  it('без часов — обучение не начато', () => {
    expect(levelOf(0).rank).toBe('none');
  });

  it('порог берётся по минутам, а не по округлённым часам', () => {
    expect(levelOf(h(1) - 1).rank).toBe('none');
    expect(levelOf(h(1)).rank).toBe('novice');
    expect(levelOf(h(1)).step).toBe(1);
  });

  it('ровно на пороге ступень уже новая', () => {
    expect(levelOf(h(100)).rank).toBe('skilled');
    expect(levelOf(h(100) - 1).rank).toBe('novice');
    expect(levelOf(h(1000)).rank).toBe('expert');
    expect(levelOf(h(5000)).rank).toBe('master');
  });

  it('выше последней ступени остаётся последняя', () => {
    expect(levelOf(h(999_999))).toBe(LEVELS[LEVELS.length - 1]);
  });

  it('мусор на входе не роняет и не выдаёт пустоту', () => {
    for (const bad of [NaN, -100, Infinity, -Infinity]) {
      expect(levelOf(bad)).toBeDefined();
      expect(levelOf(bad).rank).toBe('none');
    }
  });
});

describe('progressOf', () => {
  it('на пороге ступени доля — ноль, у следующей — единица', () => {
    expect(progressOf(h(100)).fraction).toBe(0);
    expect(progressOf(h(200)).fraction).toBe(0);
    // Ровно посередине между 100 и 200.
    expect(progressOf(h(150)).fraction).toBeCloseTo(0.5, 5);
  });

  it('считает, сколько часов осталось до следующей ступени', () => {
    expect(progressOf(h(150)).hoursToNext).toBe(50);
    expect(progressOf(h(150)).next?.hours).toBe(200);
  });

  it('прогресс по рангу меряется от начала ранга, а не от текущей ступени', () => {
    // 400 часов — «Опытный III», ранг начинался на 100, следующий на 1000.
    const progress = progressOf(h(400));
    expect(progress.level.rank).toBe('skilled');
    expect(progress.level.step).toBe(3);
    expect(progress.rankFraction).toBeCloseTo((400 - 100) / (1000 - 100), 5);
    expect(progress.hoursToNextRank).toBe(600);
    expect(progress.nextRank?.rank).toBe('expert');
  });

  it('внутри ранга полоса не откатывается на новой ступени', () => {
    // 200 и 400 — соседние ступени одного ранга: доля по рангу только растёт.
    expect(progressOf(h(400)).rankFraction).toBeGreaterThan(progressOf(h(200)).rankFraction);
  });

  it('на вершине следующей ступени нет, а доли — единицы', () => {
    const top = progressOf(h(15_000));
    expect(top.next).toBeUndefined();
    expect(top.nextRank).toBeUndefined();
    expect(top.fraction).toBe(1);
    expect(top.rankFraction).toBe(1);
    expect(top.hoursToNext).toBe(0);
    expect(top.hoursToNextRank).toBe(0);
  });

  it('нулевые часы дают начало пути, а не деление на ноль', () => {
    const start = progressOf(0);
    expect(start.level.rank).toBe('none');
    expect(start.fraction).toBe(0);
    expect(start.hoursToNext).toBe(1);
    expect(start.nextRank?.rank).toBe('novice');
  });

  it('мусор на входе читается как ноль', () => {
    expect(progressOf(NaN).minutes).toBe(0);
    expect(progressOf(-500).minutes).toBe(0);
    expect(progressOf(Infinity).hours).toBe(0);
  });
});
