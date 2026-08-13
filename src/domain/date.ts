import type { DayKey } from './types';

/**
 * Вся работа с датами идёт в локальном времени устройства: день для пользователя
 * начинается в его полночь, а не в UTC. Сдвиг по дням делается через setDate,
 * а не прибавлением 86 400 000 мс — иначе переход на летнее время съедает сутки.
 */

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

export function dayKey(date: Date): DayKey {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayKey(now: Date = new Date()): DayKey {
  return dayKey(now);
}

/** Локальная полночь указанного дня. */
export function parseDayKey(key: DayKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(date: Date, delta: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + delta);
  return next;
}

/** `YYYY-MM` — ключ месячного блока в хранилище. */
export function monthKey(key: DayKey): string {
  return key.slice(0, 7);
}

/** `01`..`31` — ключ дня внутри месячного блока. */
export function dayOfMonth(key: DayKey): string {
  return key.slice(8, 10);
}

export function composeDayKey(month: string, day: string): DayKey {
  return `${month}-${day}`;
}

/** Последние n дней, включая сегодня, от старых к новым. */
export function lastNDays(n: number, now: Date = new Date()): DayKey[] {
  const out: DayKey[] = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(dayKey(addDays(now, -i)));
  return out;
}

/** Месячные ключи, покрывающие последние n дней, — ровно те блоки, что надо подгрузить. */
export function monthsForLastDays(n: number, now: Date = new Date()): string[] {
  const months = new Set<string>();
  months.add(monthKey(dayKey(now)));
  months.add(monthKey(dayKey(addDays(now, -(n - 1)))));
  // Окно в 30 дней всегда укладывается в два месяца, но для запаса пройдём весь диапазон.
  for (let i = 0; i < n; i += 30) months.add(monthKey(dayKey(addDays(now, -i))));
  return [...months].sort();
}

/** Месячные ключи за последние months месяцев, от старых к новым. */
export function recentMonths(months: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }
  return out;
}

/** Минуты от локальной полуночи — в этом виде хранятся переходы батареи. */
export function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Минуты от полуночи обратно в часы: «19:30». */
export function formatClock(minutes: number): string {
  const total = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/**
 * Сколько дней прошло, включая оба конца. Считается по календарю, а не делением
 * миллисекунд: даты приводятся к UTC-полуночи, поэтому перевод часов не съедает сутки.
 */
export function daysBetween(from: DayKey, to: DayKey): number {
  const start = parseDayKey(from);
  const end = parseDayKey(to);
  if (end < start) return 0;
  const ms =
    Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
    Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  return Math.round(ms / 86_400_000) + 1;
}

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function formatDayShort(key: DayKey): string {
  const d = parseDayKey(key);
  return `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}`;
}

export function weekdayShort(key: DayKey): string {
  return WEEKDAYS_SHORT[parseDayKey(key).getDay()] ?? '';
}

/**
 * Минуты в человекочитаемый вид. Округление до получаса не нужно: минуты
 * приходят как кратные BLOCK_MINUTES для приоритетов и произвольные для батареи.
 */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} м`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} м`;
}

/** Компактная форма для тесных мест: «4,5 ч». */
export function formatHoursCompact(minutes: number): string {
  const hours = minutes / 60;
  if (hours === 0) return '0 ч';
  if (hours < 1) return `${Math.round(minutes)} м`;
  const rounded = Math.round(hours * 10) / 10;
  return `${String(rounded).replace('.', ',')} ч`;
}

/**
 * То же значение, но разобранное на части: целое, дробный хвост и единица.
 *
 * Нужно ровно за тем, чтобы под хвост «,5» можно было держать место, когда его
 * нет. Иначе «23,5 ч» после клика превращается в «24 ч», строка становится
 * короче на два знака, и всё, что стоит правее, прыгает влево.
 *
 * Разбирается число, а не готовая строка: разбор форматированного текста
 * регуляркой сломался бы на первом же изменении формата.
 */
export function formatHoursParts(minutes: number): { head: string; fraction: string; unit: string } {
  const hours = minutes / 60;
  if (hours === 0) return { head: '0', fraction: '', unit: 'ч' };
  if (hours < 1) return { head: String(Math.round(minutes)), fraction: '', unit: 'м' };

  const rounded = Math.round(hours * 10) / 10;
  const whole = Math.trunc(rounded);
  const tenth = Math.round((rounded - whole) * 10);
  return { head: String(whole), fraction: tenth ? `,${tenth}` : '', unit: 'ч' };
}

export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction <= 0) return '0%';
  const pct = fraction * 100;
  return `${pct < 1 ? pct.toFixed(1).replace('.', ',') : Math.round(pct)}%`;
}
