/**
 * Прямоугольники и размеры. Чистая математика без единого обращения к DOM —
 * именно она чаще всего и врёт, а проверить её глазом на телефоне нельзя.
 */

import type { Point, Rect, Size } from './types';

/** Меньше этого по обеим осям — это был тычок, а не выделение. */
const TAP = 24;

/** Прямоугольник по двум углам. Тянуть можно в любую сторону, в том числе вверх и влево. */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** Обрезать по краям кадра. Вышедший за край прямоугольник не смещается, а укорачивается. */
export function clampRect(rect: Rect, bounds: Size): Rect {
  const x = Math.min(Math.max(rect.x, 0), bounds.w);
  const y = Math.min(Math.max(rect.y, 0), bounds.h);
  return {
    x,
    y,
    w: Math.max(0, Math.min(rect.x + rect.w, bounds.w) - x),
    h: Math.max(0, Math.min(rect.y + rect.h, bounds.h) - y),
  };
}

/**
 * Перевести прямоугольник в другой масштаб — из координат показанного кадра в
 * пиксели снятого.
 *
 * Округляются не размеры, а края: иначе при коэффициенте вроде 2.75 правый край
 * уезжает на пиксель, и у выреза появляется чужая полоска.
 */
export function scaleRect(rect: Rect, k: number): Rect {
  const x = Math.round(rect.x * k);
  const y = Math.round(rect.y * k);
  return {
    x,
    y,
    w: Math.round((rect.x + rect.w) * k) - x,
    h: Math.round((rect.y + rect.h) * k) - y,
  };
}

/** Во сколько раз пересчитать содержимое, чтобы оно целиком вписалось в область. */
export function containScale(content: Size, box: Size): number {
  if (content.w <= 0 || content.h <= 0) return 1;
  return Math.min(box.w / content.w, box.h / content.h);
}

/**
 * То же, но без увеличения: для готового кадра. Мелкий вырез растягивать до
 * предела бессмысленно — пикселей от этого не прибавится, а вес вырастет вчетверо.
 */
export function fitWithin(size: Size, max: Size): number {
  return Math.min(1, containScale(size, max));
}

/**
 * Точка нажатия в координатах содержимого.
 *
 * Считается от прямоугольника показанного элемента, а не от заранее посчитанного
 * масштаба: элемент мог перевёрстаться между кадрами — клавиатура, поворот,
 * изменение безопасных зон, — и запомненный масштаб врал бы молча.
 */
export function pointIn(
  rect: { left: number; top: number; width: number; height: number },
  at: { clientX: number; clientY: number },
  content: Size,
): Point {
  return {
    x: rect.width > 0 ? ((at.clientX - rect.left) * content.w) / rect.width : 0,
    y: rect.height > 0 ? ((at.clientY - rect.top) * content.h) / rect.height : 0,
  };
}

/** Палец опустился и поднялся почти там же — человек не выделял, а просто ткнул. */
export function isTapNotDrag(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < TAP && Math.abs(a.y - b.y) < TAP;
}

/**
 * Лестница ужатия: чем жать кадр, если он не влез в предел.
 *
 * Сначала качество, потом размер — потому что на тёмном интерфейсе с
 * подсветками артефакты сжатия почти не видны, а мелкий текст после ужатия
 * читается плохо, и именно текст обычно и есть повод для тикета.
 *
 * Лестница конечна намеренно: бесконечный цикл «а вдруг ещё разок» на слабом
 * телефоне превращается в зависшее приложение. Не влезло за четыре шага —
 * тикет уйдёт без кадра, и это лучше, чем не уйдёт вовсе.
 */
const LADDER: ReadonlyArray<{ quality: number; scale: number }> = [
  { quality: 0.82, scale: 1 },
  { quality: 0.6, scale: 1 },
  { quality: 0.6, scale: 0.75 },
  { quality: 0.5, scale: 0.56 },
];

export function shrinkStep(step: number): { quality: number; scale: number } | undefined {
  return LADDER[step];
}
