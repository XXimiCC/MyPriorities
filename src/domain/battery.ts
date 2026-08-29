/**
 * Правка отметок заряда за день.
 *
 * Отметка — это момент переключения, а не отрезок: длительность считается между
 * соседними отметками. Поэтому «забыл включить зарядку перед сном» чинится не
 * правкой длительности, а добавлением отметки в 23:00 задним числом — всё, что
 * было после неё, пересчитается само.
 *
 * Функции чистые и работают со списком смен одного дня. Список всегда
 * отсортирован по возрастанию минут: на этом держится расчёт длительностей.
 */

import { addDays, dayKey, minuteOfDay, parseDayKey, todayKey } from './date';
import type { BatteryLevel, BatteryShift, DayKey, Journal } from './types';
import { DRAIN_TEXT_MAX, DRAIN_TEXT_PREFIX } from './types';

/** Минута суток, в которую нельзя поставить отметку: сутки кончаются на 1439. */
export const LAST_MINUTE = 1439;

export function clampMinute(minute: number): number {
  if (!Number.isFinite(minute)) return 0;
  return Math.max(0, Math.min(LAST_MINUTE, Math.round(minute)));
}

/**
 * Ставит отметку на указанную минуту.
 *
 * `replace` — минута правимой отметки: при смене времени старая запись должна
 * исчезнуть, иначе в дне окажутся две. Две отметки на одну минуту тоже не имеют
 * смысла — переключиться дважды в одну минуту нельзя, — поэтому совпавшая
 * заменяется.
 *
 * Причина «на нуле» переезжает вместе с отметкой, но только пока уровень
 * остаётся «на нуле»: у полного заряда причины разряда быть не может.
 */
export function setShift(
  shifts: BatteryShift[],
  minute: number,
  level: BatteryLevel,
  replace?: number,
): BatteryShift[] {
  const at = clampMinute(minute);
  const source = replace === undefined ? undefined : shifts.find((s) => s[0] === replace);
  const drainedBy = level === 1 ? source?.[2] : undefined;

  const kept = shifts.filter((s) => s[0] !== at && s[0] !== replace);
  const next: BatteryShift = drainedBy ? [at, level, drainedBy] : [at, level];
  return [...kept, next].sort((a, b) => a[0] - b[0]);
}

export function removeShift(shifts: BatteryShift[], minute: number): BatteryShift[] {
  return shifts.filter((s) => s[0] !== minute);
}

/** `HH:MM` для поля времени и подписей. */
export function formatTime(minute: number): string {
  const value = clampMinute(minute);
  const h = Math.floor(value / 60);
  const m = value % 60;
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}

/** Разбор `HH:MM`. undefined — строка не время: поле могли очистить. */
export function parseTime(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return undefined;
  return h * 60 + m;
}

/**
 * Приводит переходы заряда к валидному виду.
 *
 * Живёт рядом с остальной работой над отметками, а не в слое хранилища: правила
 * одинаковы и для записи из CloudStorage, и для строки из базы, и для файла
 * копии, который человек мог поправить руками.
 *
 * Третий элемент — ответ о расходе — необязателен: записи, сделанные до
 * появления этого вопроса, читаются без миграции.
 */
export function sanitizeShifts(raw: unknown): BatteryShift[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (s): s is [number, BatteryLevel] | [number, BatteryLevel, unknown] =>
        Array.isArray(s) &&
        s.length >= 2 &&
        Number.isFinite(s[0]) &&
        [1, 2, 3, 4].includes(s[1] as number),
    )
    .map((s): BatteryShift => {
      // Предел тот же, что у clampMinute: два числа на одно понятие рано или
      // поздно разъедутся, и в дне окажется отметка на минуту после его конца.
      const minute = Math.max(0, Math.min(LAST_MINUTE, Math.floor(s[0])));
      const level = s[1] as BatteryLevel;
      const drainedBy = s[2];
      // Длина режется: ответ своими словами приходит из поля ввода, и чужой или
      // повреждённый файл не должен раздувать месяц истории.
      return typeof drainedBy === 'string' && drainedBy.length > 0
        ? [minute, level, drainedBy.slice(0, DRAIN_TEXT_MAX + DRAIN_TEXT_PREFIX.length)]
        : [minute, level];
    })
    .sort((a, b) => a[0] - b[0]);
}

// --- Ночь --------------------------------------------------------------------

/*
 * Утреннее предложение отметить ночь.
 *
 * Состояние переходит через полночь: последняя вечерняя отметка действует до
 * следующей, поэтому ночь, которую никто не отметил, засчитывается тем
 * состоянием, в котором человек лёг. Восемь часов сна «на нуле» тянут средний
 * заряд суток вниз, а по нему день раскладывается на «низкий» и «полный» в
 * наблюдениях — цена забытого переключения выше, чем кажется.
 *
 * Чинится ночь двумя отметками: «Заряжаюсь» на время отхода ко сну и текущее
 * состояние на сейчас. Здесь только решение «спрашивать или нет» и границы
 * поля времени; пишет отметки шторка.
 */

/** Столько молчания журнала уже похоже на сон, а не на забытое переключение. */
export const NIGHT_GAP_MINUTES = 5 * 60;

/** Окно вопроса — утро: днём «когда ты лёг» уже не вопрос, а допрос. */
export const NIGHT_ASK_FROM = 4 * 60;
export const NIGHT_ASK_UNTIL = 12 * 60;

/** Первое предложение времени, пока своего ответа на этом устройстве нет. */
export const NIGHT_DEFAULT_BEDTIME = 23 * 60;

/** Последняя отметка журнала: от неё считаются и пауза, и нижняя граница поля. */
export interface LastShift {
  day: DayKey;
  minute: number;
  level: BatteryLevel;
}

/** Что это устройство помнит про утренний вопрос. Пустая память — обычное дело. */
export interface NightMemory {
  /** Сутки, в которые про ночь уже спрашивали. */
  askedOn?: DayKey;
  /** Последний ответ «когда легли». */
  bedtime?: number;
}

export interface NightAsk {
  /** Что подставить в поле: прошлый ответ, прижатый к границе, если не проходит. */
  bedtime: number;
  /**
   * Границы поля времени. `from > to` — не ошибка, а обычный случай: окно
   * начинается вчера вечером и кончается сегодня «сейчас», перескакивая полночь.
   */
  from: number;
  to: number;
  last: LastShift;
}

/** Последняя отметка во всём журнале. undefined — батарейку ещё ни разу не трогали. */
export function lastShift(journal: Journal): LastShift | undefined {
  const days = Object.keys(journal.battery)
    .filter((key) => (journal.battery[key]?.length ?? 0) > 0)
    .sort();
  const day = days[days.length - 1];
  if (day === undefined) return undefined;

  const shifts = journal.battery[day]!;
  const shift = shifts[shifts.length - 1]!;
  return { day, minute: shift[0], level: shift[1] };
}

/** Абсолютное время отметки: сутки журнала плюс минуты от локальной полуночи. */
function shiftTime(day: DayKey, minute: number): Date {
  const at = parseDayKey(day);
  at.setMinutes(at.getMinutes() + minute);
  return at;
}

/** Минута суток по кругу: за 23:59 идёт 00:00 следующих. */
function wrapMinute(minute: number): number {
  return minute > LAST_MINUTE ? 0 : minute;
}

/**
 * В какие сутки попадает введённое «когда легли».
 *
 * Время больше текущего — вчерашние (легли в 23:00, встали в 7:00), меньше или
 * равное — сегодняшние (легли в 01:30, встали в 7:00).
 *
 * undefined — отметка встала бы не позже последней существующей и ничего бы не
 * починила: всё, что после неё, и так считается по ней. Совпавшая минута тоже
 * не годится — `setShift` заменил бы ею живую отметку.
 */
export function nightBedtime(
  minute: number,
  last: LastShift,
  now: Date = new Date(),
): { day: DayKey; minute: number } | undefined {
  const at = clampMinute(minute);
  const day = at > minuteOfDay(now) ? dayKey(addDays(now, -1)) : todayKey(now);

  if (day < last.day) return undefined;
  if (day === last.day && at <= last.minute) return undefined;
  return { day, minute: at };
}

/**
 * Спрашивать ли про ночь — и с каким временем в поле.
 *
 * Чистая: журнал, память устройства и «сейчас» на входе, решение на выходе.
 * Ни хранилища, ни React — правило показа проверяется тестом, а не глазами в
 * четыре утра.
 */
export function nightAsk(
  journal: Journal,
  memory: NightMemory = {},
  now: Date = new Date(),
): NightAsk | null {
  const nowMinute = minuteOfDay(now);
  const today = todayKey(now);

  if (nowMinute < NIGHT_ASK_FROM || nowMinute >= NIGHT_ASK_UNTIL) return null;
  // Сегодня уже спрашивали: отмахнулись — значит отмахнулись, до завтра.
  if (memory.askedOn === today) return null;

  const last = lastShift(journal);
  // Батарейку ещё ни разу не трогали. Предлагать отметить ночь тому, кто не
  // знаком с самим зарядом, — объяснять вторую вещь раньше первой.
  if (!last) return null;
  // «Заряжаюсь» и есть тот ответ, который мы собирались просить: ночь отмечена.
  if (last.level === 4) return null;

  const gap = (now.getTime() - shiftTime(last.day, last.minute).getTime()) / 60_000;
  if (gap < NIGHT_GAP_MINUTES) return null;

  /*
   * Нижняя граница поля. Последняя отметка попадает в окно ввода только если
   * она сегодняшняя или вчерашняя позже «сейчас»; в остальных случаях любое
   * введённое время всё равно окажется позже неё, и границей служит начало
   * самого окна — вчерашняя минута сразу после текущей.
   */
  const reachable =
    last.day === today || (last.day === dayKey(addDays(now, -1)) && last.minute > nowMinute);
  const from = wrapMinute((reachable ? last.minute : nowMinute) + 1);

  const wanted = clampMinute(memory.bedtime ?? NIGHT_DEFAULT_BEDTIME);
  const bedtime = nightBedtime(wanted, last, now) ? wanted : from;

  return { bedtime, from, to: nowMinute, last };
}
