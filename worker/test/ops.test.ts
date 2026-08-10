import { describe, expect, it } from 'vitest';

import { sanitizeOp } from '../src/ops';

const OP_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const HLC = '001786195615026:00000:aaaa1111';

function valid(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    opId: OP_ID,
    kind: 'blk',
    hlc: HLC,
    day: '2026-08-06',
    targetId: 'ab',
    amount: 1,
    ...extra,
  };
}

describe('разбор операции на сервере', () => {
  it('целая операция проходит', () => {
    expect(sanitizeOp(valid())).toEqual({
      opId: OP_ID,
      kind: 'blk',
      hlc: HLC,
      day: '2026-08-06',
      targetId: 'ab',
      amount: 1,
      minute: null,
      level: null,
    });
  });

  it('проверки повторяются, а не берутся на веру с клиента', () => {
    // Тело запроса приходит из сети, и «клиент уже проверил» — не довод.
    expect(sanitizeOp(valid({ opId: 'не-uuid' }))).toBeUndefined();
    expect(sanitizeOp(valid({ kind: 'выдумка' }))).toBeUndefined();
    expect(sanitizeOp(valid({ day: '2026-8-6' }))).toBeUndefined();
    expect(sanitizeOp(valid({ amount: 0 }))).toBeUndefined();
    expect(sanitizeOp(null)).toBeUndefined();
  });

  it('метка обязана быть фиксированной ширины', () => {
    // На этом держится сравнение строками: «9» иначе больше «10».
    expect(sanitizeOp(valid({ hlc: '1786195615026:0:aaaa1111' }))).toBeUndefined();
    expect(sanitizeOp(valid({ hlc: 'что-то' }))).toBeUndefined();
    expect(sanitizeOp(valid({ hlc: '001786195615026:00000:ЧУЖОЕ' }))).toBeUndefined();
  });

  it('числа зажимаются, а не отбрасываются', () => {
    const op = sanitizeOp({
      opId: OP_ID,
      kind: 'batdel',
      hlc: HLC,
      day: '2026-08-06',
      minute: 99999,
    });
    expect(op?.minute).toBe(1440);
  });

  it('ответ своими словами обрезается по длине', () => {
    // Причина расхода приходит из поля ввода: чужой клиент не должен раздувать
    // строку в базе.
    const op = sanitizeOp({
      opId: OP_ID,
      kind: 'drain',
      hlc: HLC,
      day: '2026-08-06',
      minute: 540,
      targetId: 'я'.repeat(500),
    });
    expect(op?.targetId).toHaveLength(64);
  });

  it('установка итога допускает ноль, слагаемое — нет', () => {
    expect(sanitizeOp(valid({ kind: 'blkset', amount: 0 }))?.amount).toBe(0);
    expect(sanitizeOp(valid({ kind: 'blkset', amount: -1 }))).toBeUndefined();
  });

  it('барьеру ничего не нужно', () => {
    expect(sanitizeOp({ opId: OP_ID, kind: 'clear', hlc: HLC })).toMatchObject({ kind: 'clear' });
  });
});
