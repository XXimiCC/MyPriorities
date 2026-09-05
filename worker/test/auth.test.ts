/**
 * Разбор метки источника на сервере.
 *
 * Клиент проверяет её у себя (src/sync/source.ts), но тело запроса приходит из
 * сети, и «клиент уже проверил» здесь не довод — ровно как с операциями
 * (ops.test.ts). Отдельно проверяется, что кривая метка не мешает войти: она
 * справка, а не пропуск.
 */

import { describe, expect, it } from 'vitest';

import { sanitizeSource } from '../src/auth';

describe('метка источника на входе', () => {
  it('нормальная метка проходит', () => {
    expect(sanitizeSource('habr')).toBe('habr');
    expect(sanitizeSource('product-hunt')).toBe('product-hunt');
    expect(sanitizeSource('site_en')).toBe('site_en');
  });

  it('регистр и пробелы не заводят второй канал', () => {
    expect(sanitizeSource(' Habr ')).toBe('habr');
  });

  it('чего нет — того нет', () => {
    expect(sanitizeSource(undefined)).toBeUndefined();
    expect(sanitizeSource('')).toBeUndefined();
    expect(sanitizeSource(null)).toBeUndefined();
    expect(sanitizeSource(42)).toBeUndefined();
  });

  it('форма проверяется заново', () => {
    // Значение печатается в ночном отчёте разметкой HTML: узкий алфавит снимает
    // вопрос об экранировании на всём пути.
    expect(sanitizeSource('<b>habr</b>')).toBeUndefined();
    expect(sanitizeSource('ха бр')).toBeUndefined();
    expect(sanitizeSource('a'.repeat(33))).toBeUndefined();
    expect(sanitizeSource('a'.repeat(32))).toBe('a'.repeat(32));
    expect(sanitizeSource('-habr')).toBeUndefined();
  });
});
