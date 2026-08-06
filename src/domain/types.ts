import type { StringKey } from '../i18n';

/** Один клик = один сфокусированный блок. Цена блока по умолчанию. */
export const DEFAULT_BLOCK_MINUTES = 30;

/** Варианты цены блока в настройках. */
export const BLOCK_OPTIONS = [15, 20, 25, 30, 45, 60] as const;

/** По умолчанию на главном экране семь приоритетов, больше десяти добавить нельзя. */
export const DEFAULT_PRIORITY_COUNT = 7;
export const MAX_PRIORITIES = 10;
export const MIN_PRIORITIES = 1;

/** 1..3 — палочки батареи, 4 — зарядка. Числа, потому что так они и лежат в хранилище. */
export type BatteryLevel = 1 | 2 | 3 | 4;
export const BATTERY_LEVELS: BatteryLevel[] = [3, 2, 1, 4];

export interface Priority {
  id: string;
  title: string;
  /** Индекс в NEON_PALETTE. */
  colorId: number;
}

export interface Settings {
  version: 1;
  priorities: Priority[];
  /** Удалённые и вытесненные наборами приоритеты: без них статистика прошлых недель теряет подписи. */
  archived: Priority[];
  presetId?: string;
  /** Установлен ли стартовый набор — иначе показываем онбординг. */
  onboarded: boolean;
  /**
   * Сколько минут стоит один клик. Хранятся именно блоки, а не минуты, поэтому
   * смена значения переоценивает и всю прошлую историю — это осознанное поведение:
   * «клик = столько-то минут» должно быть верно и для вчерашних записей.
   */
  blockMinutes: number;
}

export function blockMinutesOf(settings: Settings): number {
  const value = settings.blockMinutes;
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BLOCK_MINUTES;
}

/** Клики за один день: id приоритета → количество блоков. */
export type DayClicks = Record<string, number>;

/**
 * Смена состояния батареи: минуты от локальной полуночи, новый уровень и —
 * только для перехода «на нуле» — id приоритета, который на это указали.
 *
 * Третий элемент необязателен намеренно: записи, сделанные до появления вопроса
 * про расход, остаются валидными и читаются без миграции.
 */
export type BatteryShift =
  | [minuteOfDay: number, level: BatteryLevel]
  | [minuteOfDay: number, level: BatteryLevel, drainedBy: string];

/** Ключ дня — локальная дата `YYYY-MM-DD`. */
export type DayKey = string;

export interface Journal {
  /** Клики по дням за все загруженные месяцы. */
  clicks: Record<DayKey, DayClicks>;
  /** Переходы батареи по дням, внутри дня отсортированы по возрастанию минут. */
  battery: Record<DayKey, BatteryShift[]>;
}

export type PeriodId = 'today' | 'week' | 'month' | 'all';

export interface Period {
  id: PeriodId;
  /** Ключ строки, а не сама строка: подпись резолвится при рендере. */
  labelKey: StringKey;
  /** Длина окна в днях, включая сегодня. null — за всё время. */
  days: number | null;
}

export const PERIODS: Period[] = [
  { id: 'today', labelKey: 'period.today', days: 1 },
  { id: 'week', labelKey: 'period.week', days: 7 },
  { id: 'month', labelKey: 'period.month', days: 30 },
  { id: 'all', labelKey: 'period.all', days: null },
];
