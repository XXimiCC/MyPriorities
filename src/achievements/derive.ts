/**
 * Предпосчёт для достижений.
 *
 * Все семьдесят с лишним условий читают отсюда, а не ходят по журналу сами:
 * иначе каждый тап по «+» стоил бы десятков тысяч итераций. Один проход по
 * истории — и дальше все проверки становятся сравнением чисел.
 */

import { addDays, dayKey, parseDayKey, todayKey } from '../domain/date';
import {
  computeBatteryStats,
  computeStats,
  daysWithBlocks,
  earliestDay,
  longestRun,
  periodDays,
  type PeriodStats,
} from '../domain/stats';
import { PERIODS, type Journal, type Settings } from '../domain/types';

const WEEK = PERIODS.find((p) => p.id === 'week')!;
const MONTH = PERIODS.find((p) => p.id === 'month')!;

/** До этой минуты — «жаворонок». */
const EARLY_BEFORE = 7 * 60;
/** Окно, которое считается ночью: с часу до пяти. */
const NIGHT_FROM = 60;
const NIGHT_TO = 5 * 60;

export interface Derived {
  totalBlocks: number;
  /** Дни, в которые был хотя бы один клик. */
  activeDays: number;
  bestStreak: number;
  /** Самый нагруженный день истории. */
  maxBlocksInDay: number;
  /** Больше всего блоков, отданных одному приоритету за один день. */
  maxOneRowInDay: number;
  /** Был ли день, в котором отмечены сразу все активные приоритеты. */
  fullDay: boolean;
  /** Самые длинные серии дней, где каждый день не пустее указанного порога. */
  bestRunMin2: number;
  bestRunMin4: number;
  /** Дней от первой записи до сегодня включительно. */
  spanDays: number;
  last7: PeriodStats;
  last30: PeriodStats;

  batteryDays: number;
  batteryShifts: number;
  /** Сколько раз отмечали «на нуле». */
  lowCount: number;
  /** Сколько раз ответили, что посадило заряд. */
  drainAnswers: number;
  earlyDays: number;
  nightDays: number;
  /** Дней подряд, где преобладал полный заряд. */
  bestFullChargeRun: number;
}

export function derive(settings: Settings, journal: Journal, now: Date = new Date()): Derived {
  let totalBlocks = 0;
  let maxBlocksInDay = 0;
  let maxOneRowInDay = 0;
  let fullDay = false;

  const activeIds = settings.priorities.map((p) => p.id);

  for (const entry of Object.values(journal.clicks)) {
    let dayBlocks = 0;
    for (const count of Object.values(entry)) {
      if (count <= 0) continue;
      dayBlocks += count;
      if (count > maxOneRowInDay) maxOneRowInDay = count;
    }
    totalBlocks += dayBlocks;
    if (dayBlocks > maxBlocksInDay) maxBlocksInDay = dayBlocks;
    if (!fullDay && activeIds.length > 0) {
      fullDay = activeIds.every((id) => (entry[id] ?? 0) > 0);
    }
  }

  const withClicks = daysWithBlocks(journal);
  const first = earliestDay(journal);
  const today = todayKey(now);

  let batteryDays = 0;
  let batteryShifts = 0;
  let lowCount = 0;
  let drainAnswers = 0;
  const earlyDaySet = new Set<string>();
  const nightDaySet = new Set<string>();

  for (const [day, shifts] of Object.entries(journal.battery)) {
    if (shifts.length === 0) continue;
    batteryDays += 1;
    batteryShifts += shifts.length;
    for (const shift of shifts) {
      if (shift[1] === 1) lowCount += 1;
      if (shift[2] !== undefined) drainAnswers += 1;
      if (shift[0] < EARLY_BEFORE) earlyDaySet.add(day);
      if (shift[0] >= NIGHT_FROM && shift[0] < NIGHT_TO) nightDaySet.add(day);
    }
  }

  // Преобладающий уровень дня считается по той же логике, что и в статистике:
  // с переносом состояния через полночь, иначе «полный заряд» на выходных
  // терялся бы просто потому, что его не переключали.
  const batteryWindow = Object.keys(journal.battery).sort();
  const fullDays: string[] = [];
  if (batteryWindow.length > 0) {
    const span: string[] = [];
    let cursor = parseDayKey(batteryWindow[0]!);
    const end = parseDayKey(today);
    while (cursor <= end) {
      span.push(dayKey(cursor));
      cursor = addDays(cursor, 1);
    }
    const stats = computeBatteryStats(journal, span, now);
    for (const day of span) {
      if (stats.perDay[day] === 3) fullDays.push(day);
    }
  }

  return {
    totalBlocks,
    activeDays: withClicks.length,
    bestStreak: longestRun(withClicks),
    maxBlocksInDay,
    maxOneRowInDay,
    fullDay,
    bestRunMin2: longestRun(daysWithBlocks(journal, 2)),
    bestRunMin4: longestRun(daysWithBlocks(journal, 4)),
    spanDays: first ? daysBetween(first, today) : 0,
    last7: computeStats(settings, journal, periodDays(WEEK, journal, now)),
    last30: computeStats(settings, journal, periodDays(MONTH, journal, now)),

    batteryDays,
    batteryShifts,
    lowCount,
    drainAnswers,
    earlyDays: earlyDaySet.size,
    nightDays: nightDaySet.size,
    bestFullChargeRun: longestRun(fullDays),
  };
}

/** Сколько дней прошло, включая оба конца. Считается по календарю, а не делением
 *  миллисекунд: даты приводятся к UTC-полуночи, поэтому перевод часов не съедает сутки. */
function daysBetween(from: string, to: string): number {
  const start = parseDayKey(from);
  const end = parseDayKey(to);
  if (end < start) return 0;
  const ms =
    Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
    Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  return Math.round(ms / 86_400_000) + 1;
}
