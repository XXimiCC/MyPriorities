/**
 * Сцена: область показа и вписанный в неё кадр.
 *
 * Размер меряется наблюдателем, а не читается один раз: внутри Telegram высота
 * окна меняется на ходу — поднимается клавиатура, разворачивается мини-апп,
 * меняются безопасные зоны. Кадр, посчитанный на первом рендере, после этого
 * съезжает, а вместе с ним съезжает и то, куда человек ткнул.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';

import { containScale } from './geometry';
import type { Size } from './types';

export function useFittedFrame(content: Size): {
  stageRef: RefObject<HTMLDivElement>;
  frame: Size;
} {
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Size>({ w: 0, h: 0 });

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return undefined;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setBox({ w: rect.width, h: rect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Ноль до первого измерения: кадр нулевого размера просто не рисуется, а
  // догадка о размере окна дала бы прыжок на первом же кадре.
  const k = box.w > 0 && box.h > 0 ? containScale(content, box) : 0;
  return { stageRef, frame: { w: content.w * k, h: content.h * k } };
}

/** Подогнать разрешение холста под его показанный размер. Возвращает плотность. */
export function sizeCanvas(canvas: HTMLCanvasElement, frame: Size): number {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(frame.w * dpr));
  const height = Math.max(1, Math.round(frame.h * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return dpr;
}
