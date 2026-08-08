import { addDays, dayKey, lastNDays, minuteOfDay, parseDayKey, todayKey } from './date';
import {
  blockMinutesOf,
  type BatteryLevel,
  type DayKey,
  type Journal,
  type Period,
  type Priority,
  type Settings,
} from './types';

/** Ненулевой приоритет всегда рисуется хотя бы такой долей ширины, иначе один блок не видно. */
export const MIN_FILL = 0.04;

const MINUTES_IN_DAY = 1440;

// --- Окна периодов -----------------------------------------------------------

/** Дни выбранного периода, от старых к новым. Для «всё время» — от первой записи до сегодня. */
export function periodDays(period: Period, journal: Journal, now: Date = new Date()): DayKey[] {
  if (period.days !== null) return lastNDays(period.days, now);

  const first = earliestDay(journal);
  const today = todayKey(now);
  if (!first || first >= today) return [today];

  const out: DayKey[] = [];
  let cursor = parseDayKey(first);
  const end = parseDayKey(today);
  while (cursor <= end) {
    out.push(dayKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function earliestDay(journal: Journal): DayKey | undefined {
  const keys = [...Object.keys(journal.clicks), ...Object.keys(journal.battery)];
  if (keys.length === 0) return undefined;
  return keys.reduce((min, key) => (key < min ? key : min));
}

// --- Приоритеты --------------------------------------------------------------

export interface PriorityStat {
  priority: Priority;
  blocks: number;
  minutes: number;
  /** Доля от суммарного времени за период. */
  share: number;
  /** Заливка полосы: нормировка по лидеру, 0..1. */
  fill: number;
  archived: boolean;
}

export interface PeriodStats {
  days: DayKey[];
  /** Активные приоритеты в порядке пользователя. */
  active: PriorityStat[];
  /** Архивные, у которых за период есть время. Порядок — по убыванию. */
  archived: PriorityStat[];
  totalBlocks: number;
  totalMinutes: number;
  /** Дни периода, в которых был хотя бы один клик. */
  activeDays: number;
}

/** Сумма блоков по каждому приоритету за набор дней. */
export function sumBlocks(journal: Journal, days: DayKey[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const day of days) {
    const entry = journal.clicks[day];
    if (!entry) continue;
    for (const [id, count] of Object.entries(entry)) {
      if (count > 0) out[id] = (out[id] ?? 0) + count;
    }
  }
  return out;
}

export function computeStats(settings: Settings, journal: Journal, days: DayKey[]): PeriodStats {
  const blocksById = sumBlocks(journal, days);
  const blockMinutes = blockMinutesOf(settings);

  // Лидер считается по всему, что будет показано, включая архив: иначе архивный
  // приоритет с большим временем вылезал бы за 100% ширины полосы.
  const shownIds = new Set(settings.priorities.map((p) => p.id));
  for (const p of settings.archived) {
    if ((blocksById[p.id] ?? 0) > 0) shownIds.add(p.id);
  }
  const leader = Math.max(0, ...[...shownIds].map((id) => blocksById[id] ?? 0));

  /*
   * Итог считается по тому же набору, что и лидер, — по показанному.
   *
   * В истории остаются id, которых нет ни среди активных, ни в архиве: архив
   * ограничен, а месяцы живут дольше. Такие блоки попадали в сумму, но не имели
   * своей строки, поэтому доли не сходились к сотне, а итог расходился со
   * столбиками в статистике, которые безымянные id как раз отбрасывают.
   */
  const totalBlocks = [...shownIds].reduce((sum, id) => sum + (blocksById[id] ?? 0), 0);
  const totalMinutes = totalBlocks * blockMinutes;

  const toStat = (priority: Priority, archived: boolean): PriorityStat => {
    const blocks = blocksById[priority.id] ?? 0;
    return {
      priority,
      blocks,
      minutes: blocks * blockMinutes,
      share: totalBlocks > 0 ? blocks / totalBlocks : 0,
      fill: fillFraction(blocks, leader),
      archived,
    };
  };

  const activeDays = days.reduce((count, day) => {
    const entry = journal.clicks[day];
    const has = entry && Object.values(entry).some((n) => n > 0);
    return has ? count + 1 : count;
  }, 0);

  return {
    days,
    active: settings.priorities.map((p) => toStat(p, false)),
    archived: settings.archived
      .filter((p) => (blocksById[p.id] ?? 0) > 0)
      .map((p) => toStat(p, true))
      .sort((a, b) => b.blocks - a.blocks),
    totalBlocks,
    totalMinutes,
    activeDays,
  };
}

export interface DaySegment {
  priority: Priority;
  blocks: number;
}

export interface DayColumn {
  day: DayKey;
  blocks: number;
  /** Порядок сегментов — порядок приоритетов пользователя, чтобы цвета не прыгали между днями. */
  segments: DaySegment[];
}

export interface DailyBreakdown {
  columns: DayColumn[];
  /** Самый нагруженный день периода: по нему масштабируется высота столбцов. */
  maxBlocks: number;
}

/** Разбивка по дням: сколько блоков в каждый день и из чего они складывались. */
export function dailyBreakdown(
  settings: Settings,
  journal: Journal,
  days: DayKey[],
): DailyBreakdown {
  const known = new Map<string, Priority>();
  settings.priorities.forEach((p) => known.set(p.id, p));
  settings.archived.forEach((p) => known.set(p.id, p));

  const rank = new Map(
    [...settings.priorities, ...settings.archived].map((p, index) => [p.id, index]),
  );

  const columns = days.map((day): DayColumn => {
    const entry = journal.clicks[day] ?? {};
    const segments: DaySegment[] = [];
    let blocks = 0;

    for (const [id, count] of Object.entries(entry)) {
      if (count <= 0) continue;
      const priority = known.get(id);
      // Идентификатор без названия остаётся только если архив переполнился и
      // вытеснил запись. Рисовать безымянный цветной сегмент хуже, чем не рисовать.
      if (!priority) continue;
      segments.push({ priority, blocks: count });
      blocks += count;
    }

    segments.sort((a, b) => (rank.get(a.priority.id) ?? 0) - (rank.get(b.priority.id) ?? 0));
    return { day, blocks, segments };
  });

  return { columns, maxBlocks: columns.reduce((max, c) => Math.max(max, c.blocks), 0) };
}

/** Нормировка по лидеру: у лидера полоса полная, у остальных — доля от него. */
export function fillFraction(value: number, leader: number): number {
  if (value <= 0 || leader <= 0) return 0;
  return Math.max(MIN_FILL, Math.min(1, value / leader));
}

/** Дни подряд с хотя бы одним кликом. Сегодняшний пустой день серию ещё не рвёт. */
export function clickStreak(journal: Journal, now: Date = new Date()): number {
  const hasClicks = (key: DayKey): boolean => {
    const entry = journal.clicks[key];
    return Boolean(entry && Object.values(entry).some((n) => n > 0));
  };

  let cursor = new Date(now.getTime());
  if (!hasClicks(dayKey(cursor))) cursor = addDays(cursor, -1);

  let streak = 0;
  while (hasClicks(dayKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Самая длинная цепочка идущих подряд дат в списке. Порядок входа не важен. */
export function longestRun(days: DayKey[]): number {
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let previous: DayKey | undefined;

  for (const day of sorted) {
    const continues = previous !== undefined && dayKey(addDays(parseDayKey(previous), 1)) === day;
    run = continues ? run + 1 : 1;
    previous = day;
    if (run > best) best = run;
  }
  return best;
}

/** Дни, в которые набралось не меньше указанного числа блоков. */
export function daysWithBlocks(journal: Journal, min = 1): DayKey[] {
  return Object.keys(journal.clicks).filter((day) => {
    const entry = journal.clicks[day];
    if (!entry) return false;
    const blocks = Object.values(entry).reduce((sum, n) => sum + (n > 0 ? n : 0), 0);
    return blocks >= min;
  });
}

/**
 * Самая длинная серия за всю историю, а не текущая.
 *
 * Нужна достижениям: трофей за тридцать дней подряд не должен исчезать в тот
 * день, когда серия прервалась. Пропущенный день рвёт серию — в этом и смысл.
 */
export function bestStreak(journal: Journal): number {
  return longestRun(daysWithBlocks(journal));
}

// --- Батарея -----------------------------------------------------------------

export interface BatteryStats {
  /** Минуты по каждому уровню за период. */
  minutes: Record<BatteryLevel, number>;
  totalMinutes: number;
  /** Доминирующий уровень каждого дня периода — для полоски по дням. */
  perDay: Record<DayKey, BatteryLevel | null>;
  /** Минуты по уровням внутри каждого дня — из них строится график энергии. */
  perDayMinutes: Record<DayKey, Record<BatteryLevel, number>>;
}

const EMPTY_LEVELS = (): Record<BatteryLevel, number> => ({ 1: 0, 2: 0, 3: 0, 4: 0 });

/** Дни с переходами, отсортированные: нужны для поиска состояния, унаследованного с прошлых суток. */
function batteryDaysSorted(journal: Journal): DayKey[] {
  return Object.keys(journal.battery)
    .filter((day) => (journal.battery[day]?.length ?? 0) > 0)
    .sort();
}

/**
 * Состояние на начало дня — последний переход самых свежих суток до него.
 * Без этого каждый день терялся бы кусок от полуночи до первого переключения,
 * а состояние, выставленное вечером и не менявшееся неделю, не считалось бы вовсе.
 *
 * Поиск двоичный, а не перебором: линейный проход повторялся для каждого дня
 * окна, и на периоде «всё время» это давало квадрат — около четырёхсот дней
 * истории превращались в полтораста тысяч шагов на каждый пересчёт.
 */
function levelEnteringDay(
  sortedDays: DayKey[],
  lastLevels: BatteryLevel[],
  day: DayKey,
): BatteryLevel | null {
  let lo = 0;
  let hi = sortedDays.length - 1;
  let found = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedDays[mid]! < day) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return found === -1 ? null : lastLevels[found]!;
}

export function computeBatteryStats(
  journal: Journal,
  days: DayKey[],
  now: Date = new Date(),
): BatteryStats {
  const sortedDays = batteryDaysSorted(journal);
  // Последний уровень каждого дня с переходами: снимается один раз, дальше
  // наследование состояния — это только поиск по отсортированному списку.
  const lastLevels = sortedDays.map((day) => {
    const shifts = journal.battery[day]!;
    return shifts[shifts.length - 1]![1];
  });
  const minutes = EMPTY_LEVELS();
  const perDay: Record<DayKey, BatteryLevel | null> = {};
  const perDayMinutes: Record<DayKey, Record<BatteryLevel, number>> = {};
  const today = todayKey(now);

  for (const day of days) {
    if (day > today) {
      perDay[day] = null;
      perDayMinutes[day] = EMPTY_LEVELS();
      continue;
    }

    const shifts = [...(journal.battery[day] ?? [])].sort((a, b) => a[0] - b[0]);
    const carried = levelEnteringDay(sortedDays, lastLevels, day);

    const timeline: Array<[number, BatteryLevel]> = [];
    if (carried !== null) timeline.push([0, carried]);
    for (const shift of shifts) {
      const at = Math.max(0, Math.min(MINUTES_IN_DAY, shift[0]));
      // Переключение ровно в полночь заменяет унаследованное состояние, а не дублирует его.
      if (timeline.length > 0 && timeline[timeline.length - 1]![0] === at) {
        timeline[timeline.length - 1] = [at, shift[1]];
      } else {
        timeline.push([at, shift[1]]);
      }
    }

    // Текущие сутки считаются только до «сейчас», иначе вечер записался бы авансом.
    const dayEnd = day === today ? minuteOfDay(now) : MINUTES_IN_DAY;

    const dayTotals = EMPTY_LEVELS();
    for (let i = 0; i < timeline.length; i += 1) {
      const [start, level] = timeline[i]!;
      const next = timeline[i + 1]?.[0] ?? dayEnd;
      const end = Math.min(next, dayEnd);
      if (end > start) dayTotals[level] += end - start;
    }

    let dominant: BatteryLevel | null = null;
    let best = 0;
    for (const level of [1, 2, 3, 4] as BatteryLevel[]) {
      minutes[level] += dayTotals[level];
      if (dayTotals[level] > best) {
        best = dayTotals[level];
        dominant = level;
      }
    }
    perDay[day] = dominant;
    perDayMinutes[day] = dayTotals;
  }

  const totalMinutes = (Object.values(minutes) as number[]).reduce((sum, n) => sum + n, 0);
  return { minutes, totalMinutes, perDay, perDayMinutes };
}

/**
 * Шкала графика энергии: «на нуле» — 0, «средний» — половина, «полный заряд» — 1.
 * Зарядки в шкале нет намеренно: это не величина заряда, а занятие, и поставить
 * её выше или ниже остальных значило бы соврать.
 */
const CHARGE_VALUE: Partial<Record<BatteryLevel, number>> = { 1: 0, 2: 0.5, 3: 1 };

/**
 * Средний заряд за набор минут по уровням, 0..1, взвешенный по времени.
 * null — заряд не отмечался вовсе или всё время ушло на восстановление: такой
 * день оставляет разрыв в линии, а не выдуманную точку внизу шкалы.
 */
export function chargeLevel(minutes: Record<BatteryLevel, number>): number | null {
  let weighted = 0;
  let total = 0;
  for (const level of [1, 2, 3] as BatteryLevel[]) {
    const value = CHARGE_VALUE[level];
    if (value === undefined) continue;
    weighted += value * minutes[level];
    total += minutes[level];
  }
  return total > 0 ? weighted / total : null;
}

/**
 * Сколько раз каждый приоритет называли причиной севшей батареи.
 * Ключ DRAIN_UNKNOWN — ответ «не знаю»: он тоже информация, поэтому не теряется.
 */
export function drainCounts(journal: Journal, days: DayKey[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const day of days) {
    for (const shift of journal.battery[day] ?? []) {
      const drainedBy = shift[2];
      if (drainedBy === undefined) continue;
      counts.set(drainedBy, (counts.get(drainedBy) ?? 0) + 1);
    }
  }
  return counts;
}

/** Ближайший уровень к средней величине заряда 0..1 — только чтобы взять цвет точки. */
export function nearestChargeLevel(charge: number): BatteryLevel {
  if (charge >= 0.75) return 3;
  if (charge >= 0.25) return 2;
  return 1;
}

/** Текущий уровень: последний переход по всей истории. null — состояние ещё не задавали. */
/**
 * Состояние, с которым день начался, — то, что перенеслось с прошлых суток.
 * Без него лента отметок непонятна: день, в котором ничего не переключали,
 * выглядит пустым, хотя всё это время человек в каком-то состоянии был.
 */
export function levelBefore(journal: Journal, day: DayKey): BatteryLevel | null {
  const days = batteryDaysSorted(journal).filter((key) => key < day);
  const last = days[days.length - 1];
  if (!last) return null;
  const shifts = journal.battery[last];
  return shifts?.[shifts.length - 1]?.[1] ?? null;
}

export function currentBatteryLevel(journal: Journal): BatteryLevel | null {
  const days = batteryDaysSorted(journal);
  const last = days[days.length - 1];
  if (!last) return null;
  const shifts = journal.battery[last];
  return shifts?.[shifts.length - 1]?.[1] ?? null;
}
