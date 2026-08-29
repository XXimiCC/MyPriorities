/**
 * Даты, у которых есть год.
 *
 * Проверяется только formatDayFull: остальные функции файла давно закрыты
 * косвенно — на них держатся ожидания insights.test.ts и локаторы съёмки.
 * Здесь же граница года, и она единственная в приложении, где подпись обязана
 * измениться от того, какой сегодня день.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { setLocale } from '../i18n';
import { formatDayFull, formatDayShort } from './date';

/** 28 августа 2026, полдень — тот же порядок величин, что и в остальных тестах. */
const NOW = new Date(2026, 7, 28, 12, 0);

// Эталон тестов — русский (см. i18n/index.ts): язык возвращается на место,
// потому что active в i18n один на весь модуль.
afterAll(() => setLocale('ru'));

describe.each([
  { code: 'ru', thisYear: '31 августа', lastYear: '31 августа 2025', future: '9 ноября 2027' },
  { code: 'en', thisYear: 'Aug 31', lastYear: 'Aug 31, 2025', future: 'Nov 9, 2027' },
])('formatDayFull, локаль $code', ({ code, thisYear, lastYear, future }) => {
  it('в текущем году года нет', () => {
    setLocale(code);
    expect(formatDayFull('2026-08-31', NOW)).toBe(thisYear);
  });

  it('в прошлом году год назван', () => {
    setLocale(code);
    expect(formatDayFull('2025-08-31', NOW)).toBe(lastYear);
  });

  it('в будущем году год тоже назван', () => {
    setLocale(code);
    expect(formatDayFull('2027-11-09', NOW)).toBe(future);
  });
});

describe('formatDayFull и formatDayShort', () => {
  it('внутри года совпадают, за его пределами — нет', () => {
    setLocale('ru');
    // Ровно то, из-за чего год и понадобился: короткая форма показывает одну и
    // ту же подпись для дат, между которыми год.
    expect(formatDayShort('2026-08-01')).toBe(formatDayShort('2025-08-01'));
    expect(formatDayFull('2026-08-01', NOW)).toBe(formatDayShort('2026-08-01'));
    expect(formatDayFull('2025-08-01', NOW)).not.toBe(formatDayFull('2026-08-01', NOW));
  });

  it('31 декабря и 1 января — соседние дни с разными подписями', () => {
    setLocale('ru');
    expect(formatDayFull('2025-12-31', NOW)).toBe('31 декабря 2025');
    expect(formatDayFull('2026-01-01', NOW)).toBe('1 января');
  });
});
