import { describe, expect, it } from 'vitest';

import { formatStamp } from './hlc';
import { byHlc, newOpId, sanitizeOp, type Op } from './ops';

const HLC = formatStamp({ wall: 1770000000000, counter: 1 }, 'aaaa1111');
const DAY = '2026-08-06';

/** Валидная операция, от которой тесты откусывают по кусочку. */
function valid(extra: Partial<Op> = {}): Record<string, unknown> {
  return { opId: 'op-1', kind: 'blk', hlc: HLC, day: DAY, targetId: 'ab', amount: 1, ...extra };
}

describe('разбор операции', () => {
  it('целая операция проходит', () => {
    expect(sanitizeOp(valid())).toEqual({
      opId: 'op-1',
      kind: 'blk',
      hlc: HLC,
      day: DAY,
      targetId: 'ab',
      amount: 1,
    });
  });

  it('без обязательных полей операции нет', () => {
    /*
     * Отбрасываем целиком, а не чиним наполовину — та же дисциплина, что у
     * sanitizeSettings и sanitizeShifts. Половинчатая операция хуже потерянной:
     * потерянную видно по расхождению счётчика, а починенная тихо его исказит.
     */
    expect(sanitizeOp(valid({ day: undefined }))).toBeUndefined();
    expect(sanitizeOp(valid({ targetId: undefined }))).toBeUndefined();
    expect(sanitizeOp(valid({ amount: undefined }))).toBeUndefined();
    expect(sanitizeOp({ ...valid(), kind: 'выдумка' })).toBeUndefined();
    expect(sanitizeOp({ ...valid(), opId: '' })).toBeUndefined();
    expect(sanitizeOp({ ...valid(), hlc: '' })).toBeUndefined();
    expect(sanitizeOp(null)).toBeUndefined();
    expect(sanitizeOp('строка')).toBeUndefined();
  });

  it('нулевое слагаемое операцией не считается', () => {
    // Оно ничего не меняет, но занимает строку в журнале и место в суточной квоте.
    expect(sanitizeOp(valid({ amount: 0 }))).toBeUndefined();
  });

  it('битая дата отбрасывает операцию, а не подставляет сегодняшнюю', () => {
    expect(sanitizeOp(valid({ day: '2026-8-6' }))).toBeUndefined();
    expect(sanitizeOp(valid({ day: 'вчера' }))).toBeUndefined();
  });

  it('минута зажимается в сутки', () => {
    const op = sanitizeOp({ opId: 'x', kind: 'batdel', hlc: HLC, day: DAY, minute: 99999 });
    expect(op?.minute).toBe(1440);
    const negative = sanitizeOp({ opId: 'x', kind: 'batdel', hlc: HLC, day: DAY, minute: -5 });
    expect(negative?.minute).toBe(0);
  });

  it('уровень заряда — только 1..4', () => {
    const good = sanitizeOp({ opId: 'x', kind: 'bat', hlc: HLC, day: DAY, minute: 540, level: 3 });
    expect(good?.level).toBe(3);
    expect(
      sanitizeOp({ opId: 'x', kind: 'bat', hlc: HLC, day: DAY, minute: 540, level: 7 }),
    ).toBeUndefined();
  });

  it('ответ своими словами проходит как есть', () => {
    // targetId у drain — это не id приоритета, а ответ, и он может быть текстом.
    const op = sanitizeOp({
      opId: 'x',
      kind: 'drain',
      hlc: HLC,
      day: DAY,
      minute: 540,
      targetId: '!дорога домой',
    });
    expect(op?.targetId).toBe('!дорога домой');
  });

  it('установка итога допускает ноль, слагаемое — нет', () => {
    const set = sanitizeOp({
      opId: 'x',
      kind: 'blkset',
      hlc: HLC,
      day: DAY,
      targetId: 'ab',
      amount: 0,
    });
    expect(set?.amount).toBe(0);
    expect(
      sanitizeOp({ opId: 'x', kind: 'blkset', hlc: HLC, day: DAY, targetId: 'ab', amount: -1 }),
    ).toBeUndefined();
  });

  it('барьеру ничего не нужно', () => {
    expect(sanitizeOp({ opId: 'x', kind: 'clear', hlc: HLC })).toEqual({
      opId: 'x',
      kind: 'clear',
      hlc: HLC,
    });
  });
});

describe('идентификаторы', () => {
  it('уникальны и имеют форму uuid', () => {
    const ids = new Set(Array.from({ length: 500 }, newOpId));
    expect(ids.size).toBe(500);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});

describe('порядок', () => {
  it('сортировка устойчива при совпавших метках', () => {
    // Метки совпадают, только если это одна операция, принесённая дважды.
    // Порядок по id делает результат независимым от порядка доставки.
    const a: Op = { opId: 'b', kind: 'clear', hlc: HLC };
    const b: Op = { opId: 'a', kind: 'clear', hlc: HLC };
    expect([a, b].sort(byHlc).map((op) => op.opId)).toEqual(['a', 'b']);
    expect([b, a].sort(byHlc).map((op) => op.opId)).toEqual(['a', 'b']);
  });
});
