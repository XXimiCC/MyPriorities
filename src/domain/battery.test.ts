import { describe, expect, it } from 'vitest';

import { LAST_MINUTE, formatTime, parseTime, removeShift, sanitizeShifts, setShift } from './battery';
import type { BatteryShift } from './types';

const day = (): BatteryShift[] => [
  [480, 3],
  [720, 2],
  [1080, 1, 'ab'],
];

describe('добавление отметки', () => {
  it('встаёт в правильное место по времени', () => {
    // Ровно тот случай, ради которого это и сделано: забыли включить зарядку
    // перед сном, вспомнили утром и дописали отметку в 23:00.
    expect(setShift(day(), 1380, 4)).toEqual([
      [480, 3],
      [720, 2],
      [1080, 1, 'ab'],
      [1380, 4],
    ]);
  });

  it('в пустой день', () => {
    expect(setShift([], 600, 2)).toEqual([[600, 2]]);
  });

  it('минута за пределами суток прижимается к краю', () => {
    expect(setShift([], 5000, 2)[0]![0]).toBe(LAST_MINUTE);
    expect(setShift([], -10, 2)[0]![0]).toBe(0);
  });

  it('вторая отметка на ту же минуту заменяет первую', () => {
    // Переключиться дважды в одну минуту нельзя — это правка, а не новая отметка.
    const shifts = setShift(day(), 720, 4);
    expect(shifts).toHaveLength(3);
    expect(shifts.find((s) => s[0] === 720)).toEqual([720, 4]);
  });
});

describe('правка отметки', () => {
  it('перенос времени не оставляет старую запись', () => {
    const shifts = setShift(day(), 900, 2, 720);
    expect(shifts.map((s) => s[0])).toEqual([480, 900, 1080]);
  });

  it('причина «на нуле» переезжает вместе с отметкой', () => {
    expect(setShift(day(), 1200, 1, 1080)).toContainEqual([1200, 1, 'ab']);
  });

  it('со сменой уровня причина исчезает', () => {
    // У полного заряда причины разряда быть не может.
    const shifts = setShift(day(), 1080, 3, 1080);
    expect(shifts.find((s) => s[0] === 1080)).toEqual([1080, 3]);
  });

  it('порядок восстанавливается, если время уехало назад', () => {
    expect(setShift(day(), 60, 1, 1080).map((s) => s[0])).toEqual([60, 480, 720]);
  });
});

describe('удаление отметки', () => {
  it('убирает только свою минуту', () => {
    expect(removeShift(day(), 720).map((s) => s[0])).toEqual([480, 1080]);
  });

  it('несуществующая минута ничего не меняет', () => {
    expect(removeShift(day(), 999)).toHaveLength(3);
  });
});

describe('время', () => {
  it('выводится с ведущими нулями', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(1439)).toBe('23:59');
  });

  it('разбирается обратно', () => {
    expect(parseTime('07:30')).toBe(450);
    expect(parseTime('7:30')).toBe(450);
    expect(parseTime('00:00')).toBe(0);
  });

  it('мусор и несуществующее время не принимаются', () => {
    // Поле могли очистить или ввести руками — молча подставлять полночь нельзя.
    for (const bad of ['', 'вечером', '25:00', '12:60', '1230']) {
      expect(parseTime(bad)).toBeUndefined();
    }
  });
});

describe('приведение отметок к валидному виду', () => {
  it('минута за концом суток прижимается к последней', () => {
    /*
     * 1440 — минута следующих суток, и приехать она может из файла копии или
     * из облака. Предел здесь обязан совпадать с clampMinute: пока их было два,
     * setShift такую отметку не создавал, а sanitizeShifts пропускал.
     */
    expect(sanitizeShifts([[1440, 2]])).toEqual([[LAST_MINUTE, 2]]);
    expect(sanitizeShifts([[99999, 3]])).toEqual([[LAST_MINUTE, 3]]);
    expect(sanitizeShifts([[-5, 4]])).toEqual([[0, 4]]);
  });

  it('сортирует по времени и отбрасывает непохожее на отметку', () => {
    expect(
      sanitizeShifts([[720, 2], ['утро', 3], [480, 9], [60, 4], null, [1080, 1, 'ab']]),
    ).toEqual([
      [60, 4],
      [720, 2],
      [1080, 1, 'ab'],
    ]);
  });
});
