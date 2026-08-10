import { describe, expect, it } from 'vitest';

import { progressOf } from './levels';
import { formatEta, paceOf, PACE_DAYS } from './pace';

/** Минуты, дающие ровно столько часов, — пороги ступеней стоят в часах. */
const hours = (n: number): number => n * 60;

describe('темп', () => {
  it('переводит окно в часы в неделю', () => {
    // 30 часов за 30 дней — это ровно 7 часов в неделю.
    const pace = paceOf(hours(30), progressOf(hours(30)));
    expect(pace.perWeek).toBeCloseTo(hours(7));
  });

  it('без движения за месяц прогноза нет', () => {
    const pace = paceOf(0, progressOf(hours(30)));
    expect(pace.minutes).toBe(0);
    expect(pace.perWeek).toBe(0);
    expect(pace.daysToNext).toBeUndefined();
  });

  it('на последней ступени прогноза нет, а темп есть', () => {
    const top = progressOf(hours(20_000));
    expect(top.next).toBeUndefined();

    const pace = paceOf(hours(30), top);
    expect(pace.perWeek).toBeGreaterThan(0);
    expect(pace.daysToNext).toBeUndefined();
  });

  it('срок считается линейно от набранного за окно', () => {
    // 30 часов накоплено, следующая ступень — 50. Двадцать часов при темпе
    // «30 часов за 30 дней» — это ровно двадцать дней.
    const pace = paceOf(hours(30), progressOf(hours(30)));
    expect(pace.daysToNext).toBeCloseTo(20);
  });

  it('вдвое меньший темп удваивает срок', () => {
    const fast = paceOf(hours(30), progressOf(hours(30)));
    const slow = paceOf(hours(15), progressOf(hours(30)));
    expect(slow.daysToNext).toBeCloseTo(fast.daysToNext! * 2);
  });

  it('мусор на входе читается как ноль, а не роняет экран', () => {
    expect(paceOf(Number.NaN, progressOf(hours(30))).perWeek).toBe(0);
    expect(paceOf(-500, progressOf(hours(30))).daysToNext).toBeUndefined();
  });

  it('окно объявлено в днях и участвует в расчёте', () => {
    expect(PACE_DAYS).toBe(30);
  });
});

describe('срок словами', () => {
  it('укрупняет единицу вместе со сроком', () => {
    expect(formatEta(5)).toBe('5 дней');
    expect(formatEta(21)).toBe('3 недели');
    expect(formatEta(210)).toBe('7 месяцев');
    expect(formatEta(1095)).toBe('3 года');
  });

  it('склоняет число по-русски', () => {
    expect(formatEta(1)).toBe('1 день');
    expect(formatEta(2)).toBe('2 дня');
    expect(formatEta(11)).toBe('11 дней');
  });

  it('недель никогда не выходит ровно одна — иначе нужен винительный падеж', () => {
    for (let days = 14; days < 60; days += 1) {
      expect(formatEta(days).startsWith('1 ')).toBe(false);
    }
  });

  it('на границах единиц не остаётся дыр', () => {
    expect(formatEta(13)).toBe('13 дней');
    expect(formatEta(14)).toBe('2 недели');
    expect(formatEta(59)).toBe('8 недель');
    expect(formatEta(60)).toBe('2 месяца');
    expect(formatEta(729)).toBe('24 месяца');
    expect(formatEta(730)).toBe('2 года');
  });

  it('дальше десяти лет счёт не ведётся', () => {
    expect(formatEta(3651)).toBe('десять лет и больше');
    expect(formatEta(100_000)).toBe('десять лет и больше');
  });

  it('пустой срок молчит', () => {
    expect(formatEta(0)).toBe('');
    expect(formatEta(-1)).toBe('');
    expect(formatEta(Number.NaN)).toBe('');
    expect(formatEta(Number.POSITIVE_INFINITY)).toBe('');
  });
});
