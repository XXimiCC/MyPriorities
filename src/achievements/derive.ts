/**
 * Предпосчёт для достижений.
 *
 * Все семьдесят с лишним условий читают отсюда, а не ходят по журналу сами:
 * иначе каждый тап по «+» стоил бы десятков тысяч итераций. Один проход по
 * истории — и дальше все проверки становятся сравнением чисел.
 */

import { addDays, dayKey, daysBetween, lastNDays, parseDayKey, todayKey } from '../domain/date';
import {
  chargeLevel,
  computeBatteryStats,
  computeStats,
  daysWithBlocks,
  earliestDay,
  longestRun,
  periodDays,
  type PeriodStats,
} from '../domain/stats';
import { PERIODS, type DayKey, type Journal, type Settings } from '../domain/types';

const WEEK = PERIODS.find((p) => p.id === 'week')!;
const MONTH = PERIODS.find((p) => p.id === 'month')!;

/**
 * Окно, которое считается ночью: с часу до пяти.
 * Раннее утро начинается там, где ночь кончается, и до семи.
 *
 * Окна не пересекаются намеренно. Пока раннее считалось от полуночи, ночное лежало
 * внутри него целиком: любая ночная отметка попадала и в «жаворонков», поэтому
 * «Сова» не могла быть получена раньше «Жаворонка» ни при каком поведении.
 */
const NIGHT_FROM = 60;
const NIGHT_TO = 5 * 60;
const EARLY_FROM = NIGHT_TO;
const EARLY_BEFORE = 7 * 60;

/**
 * Границы корзин заряда по шкале chargeLevel (0 — «на нуле», 1 — полный).
 * Середина не попадает никуда намеренно: день, проведённый в среднем заряде,
 * не свидетельствует ни за одну сторону сравнения.
 */
const LOW_CHARGE = 0.34;
const HIGH_CHARGE = 0.66;

/**
 * Сколько приоритетов должно быть в списке, чтобы «охватить все» вообще что-то значило.
 *
 * С одним приоритетом `every` истинно после первого же клика, и достижения про
 * равномерность выдавались мгновенно и незаслуженно. Двух тоже мало: охватить
 * оба — не разброс, а привычка. Порог тот же, что у оценки перекоса в реестре.
 */
export const MIN_SPREAD_PRIORITIES = 3;

/**
 * Пороги, ниже которых поле остаётся undefined.
 *
 * Ноль здесь не подходит: доля, посчитанная на двух днях истории, неотличима
 * от настоящей и врёт с уверенным видом. Тот же приём уже применён к балансу
 * в registry.ts — там leaderShare возвращает undefined вместо числа.
 */
const CONCENTRATION_MIN_BLOCKS = 20;
const LOW_ONSET_MIN_DAYS = 5;

/** Блоки по приоритетам, разложенные по состоянию заряда в тот день. */
export interface ChargeSplit {
  /** Сколько дней попало в каждую корзину: без них доли не с чем сравнивать. */
  lowDays: number;
  highDays: number;
  /** id приоритета → блоки за дни низкого заряда. */
  low: Record<string, number>;
  high: Record<string, number>;
}

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
  /** Окно дней 7–13 назад: неделя, стоящая встык к last7, и то, с чем он сравнивается. */
  prev7: PeriodStats;
  /** Последний день, в который приоритет получил хотя бы блок. */
  lastSeen: Record<string, DayKey>;
  /**
   * Блоки за месяц, разложенные на будни и выходные. Числа дней хранятся рядом:
   * пять дней против двух несравнимы, пока обе суммы не поделены на свои дни.
   */
  weekdayBlocks: number;
  weekdayDays: number;
  weekendBlocks: number;
  weekendDays: number;
  /** Сколько самых нагруженных дней месяца дают 80% его блоков. */
  daysFor80?: number;

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
  /** Медианная минута, в которую заряд впервые за день падает «на нуле». */
  lowOnsetMedian?: number;
  /** Чем занимались в дни низкого и высокого заряда — связь двух модулей. */
  chargeSplit: ChargeSplit;
}

export function derive(settings: Settings, journal: Journal, now: Date = new Date()): Derived {
  let totalBlocks = 0;
  let maxBlocksInDay = 0;
  let maxOneRowInDay = 0;
  let fullDay = false;

  const activeIds = settings.priorities.map((p) => p.id);
  const lastSeen: Record<string, DayKey> = {};

  for (const [day, entry] of Object.entries(journal.clicks)) {
    let dayBlocks = 0;
    for (const [id, count] of Object.entries(entry)) {
      if (count <= 0) continue;
      dayBlocks += count;
      if (count > maxOneRowInDay) maxOneRowInDay = count;
      const seen = lastSeen[id];
      if (seen === undefined || day > seen) lastSeen[id] = day;
    }
    totalBlocks += dayBlocks;
    if (dayBlocks > maxBlocksInDay) maxBlocksInDay = dayBlocks;
    if (!fullDay && activeIds.length >= MIN_SPREAD_PRIORITIES) {
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
  const lowOnsets: number[] = [];

  for (const [day, shifts] of Object.entries(journal.battery)) {
    if (shifts.length === 0) continue;
    batteryDays += 1;
    batteryShifts += shifts.length;
    // Интересует первое падение за сутки, а не каждое: вернуться «на ноль»
    // можно и трижды за вечер, но рассказывает о дне именно момент, когда это
    // случилось впервые.
    let onset: number | undefined;
    for (const shift of shifts) {
      if (shift[1] === 1) {
        lowCount += 1;
        if (onset === undefined || shift[0] < onset) onset = shift[0];
      }
      if (shift[2] !== undefined) drainAnswers += 1;
      if (shift[0] >= EARLY_FROM && shift[0] < EARLY_BEFORE) earlyDaySet.add(day);
      if (shift[0] >= NIGHT_FROM && shift[0] < NIGHT_TO) nightDaySet.add(day);
    }
    if (onset !== undefined) lowOnsets.push(onset);
  }

  // Преобладающий уровень дня считается по той же логике, что и в статистике:
  // с переносом состояния через полночь, иначе «полный заряд» на выходных
  // терялся бы просто потому, что его не переключали.
  const batteryWindow = Object.keys(journal.battery).sort();
  const fullDays: string[] = [];
  const chargeSplit: ChargeSplit = { lowDays: 0, highDays: 0, low: {}, high: {} };
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

      // Раскладка по корзинам едет на том же проходе: perDayMinutes здесь уже
      // посчитан, и второй обход истории ради него был бы чистой платой ни за что.
      const minutes = stats.perDayMinutes[day];
      if (!minutes) continue;
      const charge = chargeLevel(minutes);
      if (charge === null) continue;
      const low = charge <= LOW_CHARGE;
      if (!low && charge < HIGH_CHARGE) continue;

      const bucket = low ? chargeSplit.low : chargeSplit.high;
      if (low) chargeSplit.lowDays += 1;
      else chargeSplit.highDays += 1;
      for (const [id, count] of Object.entries(journal.clicks[day] ?? {})) {
        if (count > 0) bucket[id] = (bucket[id] ?? 0) + count;
      }
    }
  }

  // Месяц режется по первой записи: до неё пользователя ещё не было, и пустые
  // дни занижали бы обе средние, делая сравнение будней с выходными бессмысленным.
  const monthDays = periodDays(MONTH, journal, now).filter((day) => !first || day >= first);
  const dayTotals: number[] = [];
  let weekdayBlocks = 0;
  let weekdayDays = 0;
  let weekendBlocks = 0;
  let weekendDays = 0;
  for (const day of monthDays) {
    const total = Object.values(journal.clicks[day] ?? {}).reduce(
      (sum, n) => (n > 0 ? sum + n : sum),
      0,
    );
    dayTotals.push(total);
    const weekend = [0, 6].includes(parseDayKey(day).getDay());
    if (weekend) {
      weekendBlocks += total;
      weekendDays += 1;
    } else {
      weekdayBlocks += total;
      weekdayDays += 1;
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
    // Две недели подряд, старшая половина — предыдущая неделя. Так окна
    // заведомо стыкуются встык, без дыры и без нахлёста на границе месяца.
    prev7: computeStats(settings, journal, lastNDays(14, now).slice(0, 7)),
    lastSeen,
    weekdayBlocks,
    weekdayDays,
    weekendBlocks,
    weekendDays,
    daysFor80: daysForShare(dayTotals, 0.8),

    batteryDays,
    batteryShifts,
    lowCount,
    drainAnswers,
    earlyDays: earlyDaySet.size,
    nightDays: nightDaySet.size,
    bestFullChargeRun: longestRun(fullDays),
    lowOnsetMedian: lowOnsets.length >= LOW_ONSET_MIN_DAYS ? median(lowOnsets) : undefined,
    chargeSplit,
  };
}

/**
 * Сколько самых нагруженных дней набирают заданную долю всех блоков.
 * undefined — блоков слишком мало: на пяти блоках «80% пришлись на два дня»
 * верно арифметически и не значит ничего.
 */
function daysForShare(totals: number[], share: number): number | undefined {
  const sum = totals.reduce((acc, n) => acc + n, 0);
  if (sum < CONCENTRATION_MIN_BLOCKS) return undefined;

  const target = sum * share;
  let acc = 0;
  let days = 0;
  for (const value of [...totals].sort((a, b) => b - a)) {
    if (value <= 0) break;
    acc += value;
    days += 1;
    if (acc >= target) break;
  }
  return days;
}

/** Медиана, а не среднее: одна отметка в четыре утра не должна двигать вечер. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
