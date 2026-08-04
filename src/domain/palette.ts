import { t } from '../i18n';
import type { BatteryLevel } from './types';

export interface NeonColor {
  /** Основной тон — контур, текст, свечение. */
  hex: string;
  /** Светлый край градиента заливки: в референсах ячейка светлее своего контура. */
  soft: string;
  name: string;
}

/** Десять оттенков — ровно под лимит в десять приоритетов, каждому свой цвет. */
export const NEON_PALETTE: NeonColor[] = [
  { hex: '#22e356', soft: '#6bf58f', name: 'Зелёный' },
  { hex: '#35e0ff', soft: '#8df0ff', name: 'Циан' },
  { hex: '#4d7cff', soft: '#8fabff', name: 'Синий' },
  { hex: '#a56bff', soft: '#c9a5ff', name: 'Фиолетовый' },
  { hex: '#ff5ce1', soft: '#ff9bee', name: 'Маджента' },
  { hex: '#ff2b3d', soft: '#ff5f6b', name: 'Красный' },
  { hex: '#ff7a1a', soft: '#ffab6b', name: 'Оранжевый' },
  { hex: '#ffd400', soft: '#ffe23f', name: 'Жёлтый' },
  { hex: '#00f0b5', soft: '#6bffd9', name: 'Мятный' },
  { hex: '#ff4f8b', soft: '#ff8fb5', name: 'Розовый' },
];

export function colorOf(colorId: number): NeonColor {
  return NEON_PALETTE[colorId % NEON_PALETTE.length] ?? NEON_PALETTE[0]!;
}

/** Первый цвет, ещё не занятый ни одним приоритетом. */
export function nextFreeColorId(used: number[]): number {
  const taken = new Set(used.map((id) => id % NEON_PALETTE.length));
  for (let i = 0; i < NEON_PALETTE.length; i += 1) {
    if (!taken.has(i)) return i;
  }
  return used.length % NEON_PALETTE.length;
}

export interface BatteryTheme {
  level: BatteryLevel;
  /** Сколько ячеек из трёх залито. У зарядки залиты все — её отличает молния. */
  cells: number;
  hex: string;
  soft: string;
  /**
   * Подпись на обоях. Не переводится намеренно: в референсах она английская,
   * и это часть оформления, а не текст интерфейса.
   */
  label: string;
  charging: boolean;
}

export const BATTERY_THEMES: Record<BatteryLevel, BatteryTheme> = {
  3: { level: 3, cells: 3, hex: '#22e356', soft: '#6bf58f', label: 'HIGH', charging: false },
  2: { level: 2, cells: 2, hex: '#ffd400', soft: '#ffe23f', label: 'MEDIUM', charging: false },
  1: { level: 1, cells: 1, hex: '#ff2b3d', soft: '#ff5f6b', label: 'LOW', charging: false },
  4: { level: 4, cells: 3, hex: '#35e0ff', soft: '#8df0ff', label: 'CHARGING', charging: true },
};

export function batteryTheme(level: BatteryLevel): BatteryTheme {
  return BATTERY_THEMES[level];
}

/** Подписи резолвятся при обращении, а не при загрузке модуля: константа с текстом
 *  застыла бы на языке, выбранном до первого рендера. */
export function batteryTitle(level: BatteryLevel): string {
  return t(`battery.${level}.title`);
}

export function batteryMeaning(level: BatteryLevel): string {
  return t(`battery.${level}.meaning`);
}
