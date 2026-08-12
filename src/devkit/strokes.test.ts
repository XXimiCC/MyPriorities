import { describe, expect, it } from 'vitest';

import { drawStrokes, extendStroke, startStroke, undoStroke, type StrokeCanvas } from './strokes';
import type { Stroke } from './types';

/** Подставной холст: записывает вызовы, чтобы проверить порядок точек и масштаб. */
function fakeCanvas(): StrokeCanvas & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    strokeStyle: '',
    beginPath: () => calls.push('begin'),
    moveTo: (x, y) => calls.push(`move ${x} ${y}`),
    lineTo: (x, y) => calls.push(`line ${x} ${y}`),
    closePath: () => calls.push('close'),
    stroke: () => calls.push('stroke'),
  };
}

describe('перо', () => {
  it('прореживает дрожь пальца, но записывает движение', () => {
    let stroke = startStroke('pen', '#fff', { x: 0, y: 0 });
    stroke = extendStroke(stroke, { x: 0.5, y: 0.5 });
    expect(stroke.points).toHaveLength(2);

    stroke = extendStroke(stroke, { x: 20, y: 0 });
    expect(stroke.points).toHaveLength(3);
  });

  it('не правит штрих на месте', () => {
    // Иначе React не увидит изменения и холст не перерисуется.
    const before = startStroke('pen', '#fff', { x: 0, y: 0 });
    const after = extendStroke(before, { x: 40, y: 40 });
    expect(after).not.toBe(before);
    expect(before.points).toHaveLength(2);
  });
});

describe('рамка и стрелка', () => {
  it('вторая точка переставляется, а не копится', () => {
    let stroke = startStroke('rect', '#fff', { x: 10, y: 10 });
    stroke = extendStroke(stroke, { x: 50, y: 50 });
    stroke = extendStroke(stroke, { x: 90, y: 70 });
    expect(stroke.points).toEqual([
      { x: 10, y: 10 },
      { x: 90, y: 70 },
    ]);
  });
});

describe('отмена', () => {
  it('снимает ровно один штрих', () => {
    const strokes: Stroke[] = [
      startStroke('pen', '#fff', { x: 0, y: 0 }),
      startStroke('rect', '#fff', { x: 1, y: 1 }),
    ];
    expect(undoStroke(strokes)).toHaveLength(1);
    expect(undoStroke(strokes)[0]?.tool).toBe('pen');
  });

  it('на пустом списке ничего не ломает', () => {
    expect(undoStroke([])).toEqual([]);
  });
});

describe('отрисовка', () => {
  it('ведёт перо по точкам и умножает на масштаб', () => {
    const ctx = fakeCanvas();
    const stroke: Stroke = {
      tool: 'pen',
      color: '#ff2b3d',
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    };

    drawStrokes(ctx, [stroke], 2);

    expect(ctx.calls).toEqual(['begin', 'move 2 4', 'line 6 8', 'stroke']);
    expect(ctx.lineWidth).toBe(6);
    expect(ctx.strokeStyle).toBe('#ff2b3d');
  });

  it('рамка замыкается четырьмя углами', () => {
    const ctx = fakeCanvas();
    drawStrokes(
      ctx,
      [
        {
          tool: 'rect',
          color: '#fff',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 20 },
          ],
        },
      ],
      1,
    );

    expect(ctx.calls).toEqual([
      'begin',
      'move 0 0',
      'line 10 0',
      'line 10 20',
      'line 0 20',
      'close',
      'stroke',
    ]);
  });

  it('у стрелки два уса, и оба у острия', () => {
    const ctx = fakeCanvas();
    drawStrokes(
      ctx,
      [
        {
          tool: 'arrow',
          color: '#fff',
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
        },
      ],
      1,
    );

    // Одна линия древка и две от острия назад.
    expect(ctx.calls.filter((call) => call.startsWith('move'))).toHaveLength(3);
    expect(ctx.calls.filter((call) => call.startsWith('line'))).toHaveLength(3);
  });

  it('вырожденный штрих не роняет отрисовку', () => {
    const ctx = fakeCanvas();
    drawStrokes(ctx, [{ tool: 'pen', color: '#fff', points: [] }], 1);
    expect(ctx.calls).toEqual([]);
  });
});
