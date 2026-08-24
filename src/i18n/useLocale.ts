/**
 * Код активного языка как источник для React.
 *
 * Отдельным файлом, чтобы i18n/index.ts остался без React: его импортируют
 * domain/periods.ts, domain/snapshot.ts, skills/levels.ts и загрузчики данных
 * документации, которые собираются нодой и React видеть не должны.
 */

import { useSyncExternalStore } from 'react';

import { currentLocale, subscribeLocale } from './index';

export function useLocale(): string {
  return useSyncExternalStore(subscribeLocale, currentLocale, currentLocale);
}
