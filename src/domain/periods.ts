/**
 * Периоды статистики.
 *
 * Отдельно от остальных типов домена по одной причине: подпись периода — это
 * ключ строки, то есть зависимость от i18n. Держать её в types.ts значило бы
 * тянуть за собой интерфейс всюду, куда попадают типы данных, — а они теперь
 * попадают и в Worker, где никакого интерфейса нет.
 */

import type { StringKey } from '../i18n';

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
