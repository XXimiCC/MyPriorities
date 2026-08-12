import { useCallback, useEffect, useRef, useState } from 'react';

import type { Still } from './capture';
import { clampRect, isTapNotDrag, normalizeRect, pointIn } from './geometry';
import { useFittedFrame, sizeCanvas } from './stage';
import { s } from './strings';
import type { Point, Rect } from './types';
import './SelectLayer.css';

interface Props {
  still: Still;
  onPick(crop: Rect): void;
  onCancel(): void;
}

/**
 * Выбор области на застывшем кадре.
 *
 * Кадр уже снят — здесь показывается картинка, а не живое приложение. Это и
 * есть главное решение всей съёмки: пока человек тянет рамку, за спиной ничего
 * не меняется, и вырезано будет ровно то, что он видит.
 *
 * Сам холст кадра вставляется в дерево как есть, без копирования пикселей:
 * лишний перерисованный кадр на слабом телефоне — это лишние полсекунды.
 */
export function SelectLayer({ still, onPick, onCancel }: Props): JSX.Element {
  const { stageRef, frame } = useFittedFrame(still.css);
  const frameRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const start = useRef<Point | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  // Холст кадра живёт вне React: он приехал из съёмки готовым.
  useEffect(() => {
    const holder = frameRef.current;
    if (!holder) return undefined;
    still.canvas.className = 'dks__shot';
    holder.prepend(still.canvas);
    return () => still.canvas.remove();
  }, [still]);

  // Затемнение с окном: вырезанное место остаётся ярким, остальное гаснет.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || frame.w === 0) return;
    const dpr = sizeCanvas(canvas, frame);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const k = (frame.w / still.css.w) * dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, still.css.w, still.css.h);
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, 0, still.css.w, still.css.h);

    if (rect && rect.w > 0 && rect.h > 0) {
      ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = '#35e0ff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }
  }, [frame, rect, still.css]);

  const at = useCallback(
    (event: React.PointerEvent): Point => {
      const box = frameRef.current?.getBoundingClientRect();
      if (!box) return { x: 0, y: 0 };
      return pointIn(box, event, still.css);
    },
    [still.css],
  );

  const finish = useCallback(
    (event: React.PointerEvent): void => {
      const from = start.current;
      start.current = null;
      if (!from) return;

      const to = at(event);
      // Тычок без движения — это «сними всё окно», а не пустой вырез.
      if (isTapNotDrag(from, to)) {
        onPick({ x: 0, y: 0, w: still.css.w, h: still.css.h });
        return;
      }
      onPick(clampRect(normalizeRect(from, to), still.css));
    },
    [at, onPick, still.css],
  );

  return (
    <div className="dks">
      <div className="dks__stage" ref={stageRef}>
        <div
          className="dks__frame"
          ref={frameRef}
          style={{ width: `${frame.w}px`, height: `${frame.h}px` }}
          onPointerDown={(event) => {
            // Второй палец — это попытка пролистать, а не выделить.
            if (start.current) {
              start.current = null;
              setRect(null);
              return;
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            start.current = at(event);
            setRect(null);
          }}
          onPointerMove={(event) => {
            if (!start.current) return;
            event.preventDefault();
            setRect(clampRect(normalizeRect(start.current, at(event)), still.css));
          }}
          onPointerUp={finish}
          onPointerCancel={() => {
            start.current = null;
            setRect(null);
          }}
        >
          <canvas className="dks__overlay" ref={overlayRef} />
        </div>
      </div>

      <footer className="dks__bar">
        <button className="dk-btn" type="button" onClick={onCancel}>
          {s.cancel}
        </button>
        <span className="dks__hint">{s.selectHint}</span>
        <button
          className="dk-btn"
          type="button"
          onClick={() => onPick({ x: 0, y: 0, w: still.css.w, h: still.css.h })}
        >
          {s.whole}
        </button>
      </footer>
    </div>
  );
}
