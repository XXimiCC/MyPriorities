import { describe, expect, it } from 'vitest';

import { createClock, emptyHlc, formatStamp, observe, parseStamp, tick } from './hlc';

describe('метка времени', () => {
  it('фиксированная ширина: строковое сравнение совпадает с временным', () => {
    // Ровно ради этого метка дополняется нулями: без них "9" оказалось бы
    // больше "10", и порядок операций разъехался бы на каждом переходе разряда.
    const earlier = formatStamp({ wall: 9, counter: 0 }, 'aaaa1111');
    const later = formatStamp({ wall: 10, counter: 0 }, 'aaaa1111');
    expect(earlier < later).toBe(true);

    const first = formatStamp({ wall: 10, counter: 9 }, 'aaaa1111');
    const second = formatStamp({ wall: 10, counter: 10 }, 'aaaa1111');
    expect(first < second).toBe(true);
  });

  it('разбирается обратно', () => {
    const stamp = formatStamp({ wall: 1770000000000, counter: 7 }, 'ab12cd34');
    expect(parseStamp(stamp)).toEqual({ wall: 1770000000000, counter: 7, deviceId: 'ab12cd34' });
  });

  it('мусор меткой не считается', () => {
    expect(parseStamp('')).toBeUndefined();
    expect(parseStamp('12:0:dev')).toBeUndefined();
    expect(parseStamp(undefined)).toBeUndefined();
    expect(parseStamp(42)).toBeUndefined();
    // Двоеточие в идентификаторе сломало бы разбор, поэтому алфавит ограничен.
    expect(parseStamp(formatStamp({ wall: 1, counter: 1 }, 'a:b'))).toBeUndefined();
  });
});

describe('ход часов', () => {
  it('одна и та же миллисекунда различается счётчиком', () => {
    const a = tick(emptyHlc(), 1000);
    const b = tick(a, 1000);
    expect(a.wall).toBe(1000);
    expect(b.wall).toBe(1000);
    expect(b.counter).toBeGreaterThan(a.counter);
  });

  it('часы, переведённые назад, не откатывают метку', () => {
    const clock = createClock('aaaa1111', emptyHlc(), fakeNow([5000, 4000, 3000, 3000]));
    const stamps = [clock.stamp(), clock.stamp(), clock.stamp(), clock.stamp()];

    // Именно этого нельзя добиться от Date.now(): при сбитых часах вторая
    // операция выглядела бы старше первой и проиграла бы ей при слиянии.
    expect([...stamps].sort()).toEqual(stamps);
    expect(new Set(stamps).size).toBe(4);
  });

  it('переполнение счётчика переносится в старший разряд', () => {
    const next = tick({ wall: 1000, counter: 99999 }, 1000);
    expect(next).toEqual({ wall: 1001, counter: 0 });
  });
});

describe('чужие метки', () => {
  it('отстающие часы подтягиваются под пришедшую метку', () => {
    // Телефон отстал на час: без этого он проигрывал бы компьютеру каждое
    // сравнение и его правки всегда считались бы более старыми.
    const remote = formatStamp({ wall: 9_000_000, counter: 3 }, 'bbbb2222');
    const state = observe({ wall: 1000, counter: 0 }, remote, 1000);
    expect(state.wall).toBe(9_000_000);
    expect(state.counter).toBe(4);
  });

  it('часы из далёкого будущего за собой не тянут', () => {
    const now = 1_700_000_000_000;
    const insane = formatStamp({ wall: now + 400 * 24 * 3600 * 1000, counter: 0 }, 'cccc3333');
    const state = observe({ wall: now, counter: 0 }, insane, now);

    // Иначе одно устройство с датой в 2099 году задрало бы метку всем, с кем
    // синхронизировалось, и вернуть её назад было бы уже нечем.
    expect(state.wall).toBe(now);
  });

  it('неразборчивая метка просто двигает часы вперёд', () => {
    const state = observe({ wall: 1000, counter: 0 }, 'мусор', 2000);
    expect(state).toEqual({ wall: 2000, counter: 0 });
  });

  it('часы переживают перезапуск через сохранённое состояние', () => {
    const first = createClock('aaaa1111', emptyHlc(), fakeNow([1000, 1000]));
    first.stamp();
    const last = first.stamp();

    // Без переноса состояния счётчик начался бы с нуля и вторая сессия выдала
    // бы метку, которая уже была.
    const second = createClock('aaaa1111', first.state(), fakeNow([1000]));
    expect(second.stamp() > last).toBe(true);
  });
});

/** Часы по списку значений: последнее повторяется, если вызовов больше. */
function fakeNow(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}
