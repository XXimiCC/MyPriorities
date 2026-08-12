import { describe, expect, it } from 'vitest';

import {
  clampRect,
  containScale,
  fitWithin,
  isTapNotDrag,
  normalizeRect,
  pointIn,
  scaleRect,
  shrinkStep,
} from './geometry';

describe('выделение области', () => {
  it('тянуть можно в любую сторону', () => {
    // Вверх-влево — ровно то, что делает правша, выделяя шапку экрана.
    const down = normalizeRect({ x: 10, y: 20 }, { x: 110, y: 220 });
    const up = normalizeRect({ x: 110, y: 220 }, { x: 10, y: 20 });
    expect(down).toEqual({ x: 10, y: 20, w: 100, h: 200 });
    expect(up).toEqual(down);
  });

  it('вышедший за край укорачивается, а не съезжает', () => {
    expect(clampRect({ x: -30, y: -10, w: 100, h: 60 }, { w: 400, h: 800 })).toEqual({
      x: 0,
      y: 0,
      w: 70,
      h: 50,
    });
    expect(clampRect({ x: 380, y: 700, w: 100, h: 200 }, { w: 400, h: 800 })).toEqual({
      x: 380,
      y: 700,
      w: 20,
      h: 100,
    });
  });

  it('целиком за краем даёт пустоту, а не отрицательный размер', () => {
    expect(clampRect({ x: 500, y: 900, w: 40, h: 40 }, { w: 400, h: 800 })).toEqual({
      x: 400,
      y: 800,
      w: 0,
      h: 0,
    });
  });

  it('тычок без движения — это не выделение', () => {
    expect(isTapNotDrag({ x: 100, y: 100 }, { x: 104, y: 97 })).toBe(true);
    expect(isTapNotDrag({ x: 100, y: 100 }, { x: 140, y: 100 })).toBe(false);
    expect(isTapNotDrag({ x: 100, y: 100 }, { x: 100, y: 140 })).toBe(false);
  });
});

describe('пересчёт в пиксели кадра', () => {
  it('при обычной плотности ничего не меняет', () => {
    const rect = { x: 12, y: 40, w: 200, h: 300 };
    expect(scaleRect(rect, 1)).toEqual(rect);
  });

  it('удваивает при плотности два', () => {
    expect(scaleRect({ x: 12, y: 40, w: 200, h: 300 }, 2)).toEqual({ x: 24, y: 80, w: 400, h: 600 });
  });

  it('на дробном масштабе края не разъезжаются', () => {
    // Округляются края, а не размеры: иначе у выреза появляется чужая полоска.
    const scaled = scaleRect({ x: 10.5, y: 0, w: 100.4, h: 50 }, 2.75);
    expect(scaled.x + scaled.w).toBe(Math.round((10.5 + 100.4) * 2.75));
    expect(scaled.y + scaled.h).toBe(Math.round(50 * 2.75));
  });
});

describe('вписывание в предел', () => {
  it('маленький кадр не растягивается', () => {
    expect(fitWithin({ w: 400, h: 800 }, { w: 1280, h: 1280 })).toBe(1);
  });

  it('длинная сторона решает', () => {
    expect(fitWithin({ w: 920, h: 2560 }, { w: 1280, h: 1280 })).toBeCloseTo(0.5);
  });

  it('пустой размер не делит на ноль', () => {
    expect(fitWithin({ w: 0, h: 0 }, { w: 1280, h: 1280 })).toBe(1);
  });

  it('на экране мелкий вырез, наоборот, растягивается', () => {
    // Разные задачи: показать — во весь экран, сохранить — без лишнего веса.
    expect(containScale({ w: 100, h: 200 }, { w: 400, h: 800 })).toBe(4);
    expect(fitWithin({ w: 100, h: 200 }, { w: 400, h: 800 })).toBe(1);
  });
});

describe('точка нажатия', () => {
  const rect = { left: 20, top: 100, width: 200, height: 400 };

  it('переводится в координаты содержимого', () => {
    expect(pointIn(rect, { clientX: 120, clientY: 300 }, { w: 400, h: 800 })).toEqual({ x: 200, y: 400 });
  });

  it('нулевой прямоугольник не делит на ноль', () => {
    expect(pointIn({ left: 0, top: 0, width: 0, height: 0 }, { clientX: 5, clientY: 5 }, { w: 10, h: 10 })).toEqual(
      { x: 0, y: 0 },
    );
  });
});

describe('лестница ужатия', () => {
  it('сначала жмёт качество, потом размер', () => {
    const first = shrinkStep(0);
    const second = shrinkStep(1);
    expect(first).toEqual({ quality: 0.82, scale: 1 });
    expect(second?.quality).toBeLessThan(first!.quality);
    expect(second?.scale).toBe(1);
    expect(shrinkStep(2)?.scale).toBeLessThan(1);
  });

  it('никогда не идёт вспять', () => {
    let previous = shrinkStep(0)!;
    for (let step = 1; shrinkStep(step); step += 1) {
      const next = shrinkStep(step)!;
      expect(next.quality * next.scale).toBeLessThanOrEqual(previous.quality * previous.scale);
      previous = next;
    }
  });

  it('кончается — иначе слабый телефон завис бы на «а вдруг ещё разок»', () => {
    let step = 0;
    while (shrinkStep(step)) {
      step += 1;
      expect(step).toBeLessThan(100);
    }
    expect(step).toBeGreaterThan(0);
  });
});
