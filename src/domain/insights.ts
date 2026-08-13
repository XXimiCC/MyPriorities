/**
 * Наблюдения: что видно в собственных данных, если посмотреть на них дважды.
 *
 * Тон здесь один и он важнее содержания — наблюдение, а не совет. Приложение
 * обещало в онбординге «не говорить, как надо жить», и каждая карточка обязана
 * это обещание держать: сообщается факт из отметок пользователя, без оценки,
 * без «стоит» и без «попробуйте».
 *
 * Окна фиксированы и НЕ следуют переключателю периода на экране. Иначе одна и
 * та же карточка меняла бы смысл вместе с переключателем, и «стало вдвое чаще»
 * переставало бы быть проверяемым утверждением.
 *
 * Считается всё из готового Derived, журнал сюда не приходит: второй проход по
 * истории ради тех же чисел — плата ни за что.
 */

import { daysBetween, formatClock, formatHoursCompact, todayKey } from './date';
import { blockMinutesOf, type Priority, type Settings } from './types';
import type { ChargeSplit, Derived } from '../achievements/derive';
import type { Params, StringKey } from '../i18n';
import { fillUnits, type UnitTable } from '../i18n/units';

/** Больше трёх карточек подряд читать перестают, и сильное тонет в проходном. */
export const MAX_INSIGHTS = 3;

/**
 * Пороги, ниже которых наблюдение молчит.
 *
 * Все они про одно: утверждение о жизни нельзя делать на двух днях истории.
 * Молчащая карточка честнее уверенной и пустой, поэтому наблюдение возвращает
 * undefined и не показывается вовсе — на экране не остаётся даже места под него.
 */
const MIN_BUCKET_DAYS = 3;
const MIN_SPLIT_BLOCKS = 6;
const MIN_PREV_WEEK_BLOCKS = 10;
const MIN_QUIET_BLOCKS = 8;
const MIN_WEEKEND_BLOCKS = 20;
const MIN_WEEKDAY_DAYS = 5;
const MIN_WEEKEND_DAYS = 2;

/**
 * Насколько разница должна быть заметной, чтобы о ней стоило говорить.
 * Пороги разные, потому что меряют разное: у заряда это блоки за день,
 * у сравнения недель — блоки за всю неделю.
 */
const MIN_DAILY_GAP = 0.5;
const MIN_WEEKLY_GAP = 3;

/**
 * Одного абсолютного порога мало. «В будни 4,5 часа, в выходные 4,8» проходит
 * любой разумный разрыв в блоках и при этом не сообщает ничего: разница тонет
 * в самих числах. Поэтому величины должны разойтись ещё и в разы.
 */
const MIN_RATIO = 1.35;

/** Разошлись ли две величины настолько, чтобы об этом стоило сказать вслух. */
function notable(a: number, b: number, minGap: number): boolean {
  if (Math.abs(a - b) < minGap) return false;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  // Ноль против чего угодно — уже расхождение в разы, делить не на что.
  return low <= 0 || high / low >= MIN_RATIO;
}

export type InsightId =
  | 'charge'
  | 'weekOverWeek'
  | 'quiet'
  | 'concentration'
  | 'weekend'
  | 'lowOnset';

export interface Insight {
  id: InsightId;
  key: StringKey;
  params?: Params;
  /**
   * Цвет приоритета, о котором речь, — тот же индекс палитры, что и в списке.
   * Нужен, чтобы имя в тексте было видно так же, как в остальном приложении:
   * наблюдение про «Работу» и полоса «Работы» должны узнаваться одним цветом.
   */
  colorId?: number;
}

const INSIGHT_UNITS: UnitTable = {
  'ins.quiet': { n: 'day' },
  'ins.concentration': { n: 'day', active: 'day' },
};

/** Готовый текст карточки: формы слов подставляются так же, как в достижениях. */
export function insightText(insight: Insight): string {
  return fillUnits(INSIGHT_UNITS, insight.key, insight.params);
}

/**
 * Все наблюдения, для которых хватило данных, — от самых содержательных к общим.
 * Порядок фиксированный, а не по силе сигнала: он задаёт, какие три карточки
 * увидит человек, и прыгающий каждый день список читался бы как шум.
 */
export function insights(settings: Settings, derived: Derived, now: Date = new Date()): Insight[] {
  const found = [
    chargeInsight(settings, derived),
    weekOverWeekInsight(settings, derived),
    quietInsight(settings, derived, now),
    concentrationInsight(derived),
    weekendInsight(settings, derived),
    lowOnsetInsight(derived),
  ];
  return found.filter((item): item is Insight => item !== undefined);
}

// --- Наблюдения --------------------------------------------------------------

/**
 * Связь заряда и занятий — единственное место, где два модуля смотрят друг на
 * друга. Сравниваются не суммы, а темп за день: дней низкого заряда почти всегда
 * меньше, и по суммам любой приоритет «оказался бы важнее на подъёме».
 */
function chargeInsight(settings: Settings, derived: Derived): Insight | undefined {
  const split = derived.chargeSplit;
  if (split.lowDays < MIN_BUCKET_DAYS || split.highDays < MIN_BUCKET_DAYS) return undefined;

  const blockMinutes = blockMinutesOf(settings);
  const best = pickWidestGap(settings.priorities, MIN_DAILY_GAP, (id) => rates(split, id));
  if (!best) return undefined;

  return {
    id: 'charge',
    key: 'ins.charge',
    colorId: best.priority.colorId,
    params: {
      title: best.priority.title,
      low: formatHoursCompact(best.a * blockMinutes),
      high: formatHoursCompact(best.b * blockMinutes),
    },
  };
}

function rates(split: ChargeSplit, id: string): [number, number] | undefined {
  const low = split.low[id] ?? 0;
  const high = split.high[id] ?? 0;
  // Приоритет, отмеченный пять раз за всю историю, покажет любую разницу.
  if (low + high < MIN_SPLIT_BLOCKS) return undefined;
  return [low / split.lowDays, high / split.highDays];
}

/** Неделя против предыдущей. Окна стыкуются встык, поэтому сравнение честное. */
function weekOverWeekInsight(settings: Settings, derived: Derived): Insight | undefined {
  if (derived.prev7.totalBlocks < MIN_PREV_WEEK_BLOCKS) return undefined;

  const blockMinutes = blockMinutesOf(settings);
  const before = new Map(derived.prev7.active.map((stat) => [stat.priority.id, stat.blocks]));
  const best = pickWidestGap(settings.priorities, MIN_WEEKLY_GAP, (id) => {
    const now = derived.last7.active.find((stat) => stat.priority.id === id)?.blocks ?? 0;
    const then = before.get(id) ?? 0;
    if (now + then < MIN_SPLIT_BLOCKS) return undefined;
    // Обе недели по семь дней, поэтому делить не на что: блоки уже сравнимы.
    return [now, then];
  });
  if (!best) return undefined;

  return {
    id: 'weekOverWeek',
    key: 'ins.weekOverWeek',
    colorId: best.priority.colorId,
    params: {
      title: best.priority.title,
      now: formatHoursCompact(best.a * blockMinutes),
      before: formatHoursCompact(best.b * blockMinutes),
    },
  };
}

/**
 * Приоритет, который был в месяце и пропал из недели. Именно пропажу труднее
 * всего заметить самому: полоса просто перестаёт расти, и глазу не за что зацепиться.
 */
function quietInsight(settings: Settings, derived: Derived, now: Date): Insight | undefined {
  const today = todayKey(now);
  const blockMinutes = blockMinutesOf(settings);

  let best: { priority: Priority; days: number; blocks: number } | undefined;
  for (const priority of settings.priorities) {
    const month = derived.last30.active.find((s) => s.priority.id === priority.id)?.blocks ?? 0;
    const week = derived.last7.active.find((s) => s.priority.id === priority.id)?.blocks ?? 0;
    if (week > 0 || month < MIN_QUIET_BLOCKS) continue;

    const seen = derived.lastSeen[priority.id];
    if (!seen) continue;
    // daysBetween считает оба конца, а нужен разрыв: в день последней отметки он нулевой.
    const days = daysBetween(seen, today) - 1;
    if (days <= 0) continue;
    if (!best || days > best.days) best = { priority, days, blocks: month };
  }
  if (!best) return undefined;

  return {
    id: 'quiet',
    key: 'ins.quiet',
    colorId: best.priority.colorId,
    params: {
      title: best.priority.title,
      n: best.days,
      before: formatHoursCompact(best.blocks * blockMinutes),
    },
  };
}

/**
 * Ровно ли распределён месяц. Отвечает на вопрос, который суммы за период
 * скрывают по построению: тридцать часов можно прожить размеренно, а можно
 * выгрести за три дня, и в итоговой цифре это одно и то же число.
 */
function concentrationInsight(derived: Derived): Insight | undefined {
  const days = derived.daysFor80;
  const active = derived.last30.activeDays;
  if (days === undefined || active === 0) return undefined;
  // Если восемьдесят процентов размазаны почти по всем активным дням,
  // сообщать нечего: это и есть ровная жизнь, а не наблюдение о ней.
  if (days * 2 > active) return undefined;

  return { id: 'concentration', key: 'ins.concentration', params: { n: days, active } };
}

/** Будни против выходных — обязательно на день, иначе пять против двух не сравнить. */
function weekendInsight(settings: Settings, derived: Derived): Insight | undefined {
  const { weekdayBlocks, weekdayDays, weekendBlocks, weekendDays } = derived;
  if (weekdayDays < MIN_WEEKDAY_DAYS || weekendDays < MIN_WEEKEND_DAYS) return undefined;
  if (weekdayBlocks + weekendBlocks < MIN_WEEKEND_BLOCKS) return undefined;

  const weekday = weekdayBlocks / weekdayDays;
  const weekend = weekendBlocks / weekendDays;
  if (!notable(weekday, weekend, MIN_DAILY_GAP)) return undefined;

  const blockMinutes = blockMinutesOf(settings);
  return {
    id: 'weekend',
    key: 'ins.weekend',
    params: {
      weekday: formatHoursCompact(weekday * blockMinutes),
      weekend: formatHoursCompact(weekend * blockMinutes),
    },
  };
}

/** Единственное применение минутной точности, которая в переходах заряда есть. */
function lowOnsetInsight(derived: Derived): Insight | undefined {
  if (derived.lowOnsetMedian === undefined) return undefined;
  return {
    id: 'lowOnset',
    key: 'ins.lowOnset',
    params: { time: formatClock(derived.lowOnsetMedian) },
  };
}

// --- Общее -------------------------------------------------------------------

/**
 * Приоритет с самым большим разрывом между двумя величинами.
 * Пара `undefined` означает «данных мало» и выбывает — так порог задаётся один
 * раз внутри измерителя, а не повторяется в каждом наблюдении.
 */
function pickWidestGap(
  priorities: Priority[],
  minGap: number,
  measure: (id: string) => [number, number] | undefined,
): { priority: Priority; a: number; b: number } | undefined {
  let best: { priority: Priority; a: number; b: number } | undefined;
  for (const priority of priorities) {
    const pair = measure(priority.id);
    if (!pair) continue;
    if (!notable(pair[0], pair[1], minGap)) continue;
    const gap = Math.abs(pair[0] - pair[1]);
    if (!best || gap > Math.abs(best.a - best.b)) {
      best = { priority, a: pair[0], b: pair[1] };
    }
  }
  return best;
}
