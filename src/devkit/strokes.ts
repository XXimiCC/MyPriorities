/**
 * Штрихи разметки: модель, отмена и отрисовка.
 *
 * Отрисовка принимает не CanvasRenderingContext2D, а узкий набор из шести
 * методов. Так её можно проверить в node на подставном холсте — а проверять
 * тут есть что: координаты умножаются на масштаб, и ошибка в масштабе видна
 * только на телефоне с плотностью 3.
 */

import type { Point, Stroke, Tool } from './types';

/** Толщина в координатах показанного кадра. Умножается на масштаб при экспорте. */
const WIDTH = 3;

/** Ближе этого новая точка пера не записывается: трёхсекундная закорючка — 80 точек, а не 800. */
const MIN_STEP = 2;

/** Длина уса стрелки и его угол. */
const HEAD = 14;
const HEAD_ANGLE = Math.PI / 7;

export const COLORS = ['#ff2b3d', '#35e0ff'] as const;

export function startStroke(tool: Tool, color: string, at: Point): Stroke {
  // Вторая точка сразу: и рамка, и стрелка описываются ровно двумя, а перо
  // всё равно допишет свои. Штрих из одной точки пришлось бы проверять везде.
  return { tool, color, points: [at, at] };
}

/**
 * Продолжить штрих. Возвращает новый объект: состояние React меняется целиком,
 * и правка на месте оставила бы холст без перерисовки.
 */
export function extendStroke(stroke: Stroke, at: Point): Stroke {
  if (stroke.tool !== 'pen') {
    // У рамки и стрелки вторая точка не добавляется, а переставляется.
    return { ...stroke, points: [stroke.points[0] ?? at, at] };
  }

  const last = stroke.points[stroke.points.length - 1];
  if (last && Math.hypot(at.x - last.x, at.y - last.y) < MIN_STEP) return stroke;
  return { ...stroke, points: [...stroke.points, at] };
}

/** Отменить последний штрих. Ни повтора, ни «стереть всё»: отмена и новый выбор области — это и есть «стереть всё». */
export function undoStroke(strokes: Stroke[]): Stroke[] {
  return strokes.slice(0, -1);
}

/** Ровно то, что нужно отрисовке. Узко намеренно — см. заголовок файла. */
export interface StrokeCanvas {
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  stroke(): void;
}

function drawArrow(ctx: StrokeCanvas, from: Point, to: Point, k: number): void {
  ctx.moveTo(from.x * k, from.y * k);
  ctx.lineTo(to.x * k, to.y * k);

  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  for (const side of [HEAD_ANGLE, -HEAD_ANGLE]) {
    ctx.moveTo(to.x * k, to.y * k);
    ctx.lineTo((to.x - HEAD * Math.cos(angle - side)) * k, (to.y - HEAD * Math.sin(angle - side)) * k);
  }
}

/** Нарисовать все штрихи. `k` — во сколько раз координаты кадра больше показанных. */
export function drawStrokes(ctx: StrokeCanvas, strokes: readonly Stroke[], k: number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = WIDTH * k;

  for (const stroke of strokes) {
    const first = stroke.points[0];
    const last = stroke.points[stroke.points.length - 1];
    if (!first || !last) continue;

    ctx.strokeStyle = stroke.color;
    ctx.beginPath();

    if (stroke.tool === 'pen') {
      ctx.moveTo(first.x * k, first.y * k);
      for (const point of stroke.points.slice(1)) ctx.lineTo(point.x * k, point.y * k);
    } else if (stroke.tool === 'rect') {
      ctx.moveTo(first.x * k, first.y * k);
      ctx.lineTo(last.x * k, first.y * k);
      ctx.lineTo(last.x * k, last.y * k);
      ctx.lineTo(first.x * k, last.y * k);
      ctx.closePath();
    } else {
      drawArrow(ctx, first, last, k);
    }

    ctx.stroke();
  }
}
