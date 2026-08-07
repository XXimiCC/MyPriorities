/**
 * Лестница мастерства: пять рангов по четыре ступени, мастер с пяти тысяч часов.
 *
 * Ступени внутри ранга нужны потому, что путь от «опытного» до «эксперта» —
 * это девятьсот часов, и без промежуточных отметок прогресс полтора года
 * выглядит как неподвижная полоса. В среднем новая ступень берётся раз в
 * полтора накопленного, поэтому движение видно и на тридцати часах, и на трёх тысячах.
 *
 * Пороги стоят на узнаваемых вехах: 20 часов — «правило двадцати часов»,
 * 1000 и 10 000 — общеизвестные числа. Точность здесь не важна, важна честность
 * порядка величины: «эксперт» не должен наступать через месяц занятий.
 */

import { t } from '../i18n';

export type RankId = 'none' | 'novice' | 'skilled' | 'expert' | 'master';

export interface Level {
  /** Сквозной номер ступени, 0..16. */
  index: number;
  rank: RankId;
  /** Номер внутри ранга, 1..4. Ноль только у «обучение не начато». */
  step: 0 | 1 | 2 | 3 | 4;
  /** Часы, с которых ступень начинается. */
  hours: number;
}

const MINUTES_IN_HOUR = 60;

/** Ступеней в каждом настоящем ранге. От этого числа считается римская цифра. */
export const STEPS_PER_RANK = 4;

const THRESHOLDS: ReadonlyArray<readonly [RankId, number]> = [
  ['none', 0],
  ['novice', 1],
  ['novice', 10],
  ['novice', 20],
  ['novice', 50],
  ['skilled', 100],
  ['skilled', 200],
  ['skilled', 400],
  ['skilled', 700],
  ['expert', 1000],
  ['expert', 1600],
  ['expert', 2500],
  ['expert', 3600],
  ['master', 5000],
  ['master', 7000],
  ['master', 10000],
  ['master', 15000],
];

export const LEVELS: readonly Level[] = THRESHOLDS.map(([rank, hours], index) => ({
  index,
  rank,
  // «Не начато» стоит первым и вне нумерации, поэтому остальные считаются от него.
  step: (rank === 'none' ? 0 : ((index - 1) % STEPS_PER_RANK) + 1) as Level['step'],
  hours,
}));

/** Первая ступень каждого ранга — с неё начинается отсчёт прогресса по рангу. */
const RANK_START = new Map<RankId, Level>();
for (const level of LEVELS) {
  if (!RANK_START.has(level.rank)) RANK_START.set(level.rank, level);
}

/** Порядок рангов по старшинству — чтобы сравнивать «эксперт и выше». */
export const RANK_ORDER: Record<RankId, number> = {
  none: 0,
  novice: 1,
  skilled: 2,
  expert: 3,
  master: 4,
};

export function atLeastRank(rank: RankId, floor: RankId): boolean {
  return RANK_ORDER[rank] >= RANK_ORDER[floor];
}

/** Мусор на входе не должен ронять экран: отрицательное и нечисловое читается как ноль. */
function safeMinutes(minutes: number): number {
  return Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
}

/**
 * Сравнение идёт в минутах, а не в часах: пороги целые, минуты целые, и
 * деление на 60 нигде не может подвинуть ступень на границе.
 */
export function levelOf(minutes: number): Level {
  const value = safeMinutes(minutes);
  let found = LEVELS[0]!;
  for (const level of LEVELS) {
    if (value < level.hours * MINUTES_IN_HOUR) break;
    found = level;
  }
  return found;
}

export interface Progress {
  level: Level;
  /** Следующая ступень. undefined — дальше некуда. */
  next?: Level;
  minutes: number;
  hours: number;
  /** Доля пройденного до следующей ступени, 0..1. На последней — 1. */
  fraction: number;
  hoursToNext: number;
  /** Первая ступень следующего ранга. */
  nextRank?: Level;
  /** Доля пройденного до следующего ранга, 0..1. */
  rankFraction: number;
  hoursToNextRank: number;
}

function span(value: number, from: number, to: number): number {
  if (to <= from) return 1;
  return Math.max(0, Math.min(1, (value - from) / (to - from)));
}

export function progressOf(minutes: number): Progress {
  const value = safeMinutes(minutes);
  const hours = value / MINUTES_IN_HOUR;
  const level = levelOf(value);
  const next = LEVELS[level.index + 1];
  const nextRank = LEVELS.find((item) => item.index > level.index && item.rank !== level.rank);

  // Прогресс по рангу меряется от начала ранга, а не от текущей ступени:
  // иначе полоса откатывалась бы назад на каждой новой ступени внутри ранга.
  const rankStart = RANK_START.get(level.rank) ?? LEVELS[0]!;

  return {
    level,
    next,
    minutes: value,
    hours,
    fraction: next ? span(hours, level.hours, next.hours) : 1,
    hoursToNext: next ? Math.max(0, next.hours - hours) : 0,
    nextRank,
    rankFraction: nextRank ? span(hours, rankStart.hours, nextRank.hours) : 1,
    hoursToNextRank: nextRank ? Math.max(0, nextRank.hours - hours) : 0,
  };
}

const ROMAN = ['', 'I', 'II', 'III', 'IV'] as const;

/** Подписи резолвятся при обращении: константа с текстом застыла бы на языке до первого рендера. */
export function rankTitle(rank: RankId): string {
  return t(`rank.${rank}`);
}

export function levelTitle(level: Level): string {
  const rank = rankTitle(level.rank);
  if (level.step === 0) return rank;
  return t('level.title', { rank, step: ROMAN[level.step] });
}
