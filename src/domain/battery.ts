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

import type { BatteryLevel, BatteryShift } from './types';

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
