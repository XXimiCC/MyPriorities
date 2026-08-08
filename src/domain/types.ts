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

/**
 * Части приложения, которые включаются и выключаются целиком.
 *
 * Выключенный модуль исчезает из интерфейса, но своих данных не теряет:
 * тумблер — это про внимание, а не про сброс. Поэтому каталог навыков и
 * достижения читаются из хранилища всегда, независимо от флага.
 */
export interface Modules {
  skills: boolean;
  achievements: boolean;
  insights: boolean;
}

export const DEFAULT_MODULES: Modules = { skills: true, achievements: true, insights: true };

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
  /**
   * Поле обязательное намеренно: тогда каждое место, где настройки собираются
   * литералом, — ошибка компиляции, и забыть его нельзя. Толерантность к старым
   * записям обеспечивает modulesOf, а не необязательность типа.
   */
  modules: Modules;
}

export function blockMinutesOf(settings: Settings): number {
  const value = settings.blockMinutes;
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BLOCK_MINUTES;
}

/**
 * Приводит что угодно к набору флагов. Запись, сделанная до появления модулей,
 * читается как «всё включено»: новая возможность должна показаться сама,
 * а не ждать, пока её найдут в настройках.
 */
export function sanitizeModules(raw: unknown): Modules {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Modules>;
  return {
    skills: typeof value.skills === 'boolean' ? value.skills : DEFAULT_MODULES.skills,
    achievements:
      typeof value.achievements === 'boolean' ? value.achievements : DEFAULT_MODULES.achievements,
    insights: typeof value.insights === 'boolean' ? value.insights : DEFAULT_MODULES.insights,
  };
}

export function modulesOf(settings: Settings): Modules {
  return sanitizeModules(settings.modules);
}

/** Клики за один день: id приоритета → количество блоков. */
export type DayClicks = Record<string, number>;

/** Клики по дням. Форма общая: так лежат и приоритеты, и навыки. */
export type ClicksMap = Record<DayKey, DayClicks>;

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

/**
 * Ответ «не знаю» на вопрос о расходе.
 *
 * Непустая строка, а не `''`, намеренно: пустую сериализация не отличала от
 * «ответа не было» и выбрасывала при чтении. Ответ доживал до перезагрузки и
 * исчезал, а счётчик ответов расходился со статистикой причин.
 * Знак не может совпасть с id приоритета — те состоят из букв и цифр.
 */
export const DRAIN_UNKNOWN = '?';

/**
 * Ответ своими словами: `!` плюс текст.
 *
 * Префикс по той же причине, что и знак у «не знаю»: id приоритетов состоят из
 * букв и цифр, поэтому ни один из них не начинается с `!`, и статистика всегда
 * знает, что перед ней — ссылка на приоритет или чужая причина.
 */
export const DRAIN_TEXT_PREFIX = '!';

/**
 * Предел длины ответа. Причина расхода — подпись в статистике, а не дневник:
 * длинный текст и в строку не влезет, и раздует месяц истории, который целиком
 * ездит в CloudStorage.
 */
export const DRAIN_TEXT_MAX = 40;

/** Ответ своими словами → значение для журнала. undefined, если писать нечего. */
export function drainCustom(text: string): string | undefined {
  const trimmed = text.trim().slice(0, DRAIN_TEXT_MAX).trim();
  return trimmed ? DRAIN_TEXT_PREFIX + trimmed : undefined;
}

/** Обратное преобразование: текст ответа либо undefined, если это не он. */
export function drainTextOf(drainedBy: string): string | undefined {
  if (!drainedBy.startsWith(DRAIN_TEXT_PREFIX)) return undefined;
  const text = drainedBy.slice(DRAIN_TEXT_PREFIX.length).trim();
  return text || undefined;
}

/** Ключ дня — локальная дата `YYYY-MM-DD`. */
export type DayKey = string;

export interface Journal {
  /** Клики по дням за все загруженные месяцы. */
  clicks: ClicksMap;
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
