import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Still } from './capture';
import { clampRect, pointIn, scaleRect } from './geometry';
import { sizeCanvas, useFittedFrame } from './stage';
import { s } from './strings';
import { COLORS, drawStrokes, extendStroke, startStroke, undoStroke } from './strokes';
import type { Rect, Stroke, Tool } from './types';
import './AnnotateLayer.css';

interface Props {
  still: Still;
  crop: Rect;
  strokes: Stroke[];
  onChange(strokes: Stroke[]): void;
  onBack(): void;
  onNext(): void;
}

const TOOLS: Array<{ id: Tool; label: string; icon: string }> = [
  { id: 'pen', label: s.pen, icon: 'M4 20c3-1 5-2 7-4l7-7-3-3-7 7c-2 2-3 4-4 7z' },
  { id: 'rect', label: s.rect, icon: 'M4 6h16v12H4z' },
  { id: 'arrow', label: s.arrow, icon: 'M5 19L19 5M11 5h8v8' },
];

/**
 * Разметка поверх выреза.
 *
 * Инструментов ровно три, цветов два, отмена без повтора. Это не редактор:
 * задача разметки — показать, куда смотреть, и всё, что сверх этого, крадёт
 * время у того, ради чего панель и написана.
 *
 * Штрихи хранятся в координатах всего кадра, а не выреза: тогда экспорт (см.
 * capture.ts) масштабирует их той же матрицей, что и картинку, и лишнего
 * пересчёта между «показать» и «сохранить» не существует.
 */
export function AnnotateLayer({ still, crop, strokes, onChange, onBack, onNext }: Props): JSX.Element {
  const { stageRef, frame } = useFittedFrame({ w: crop.w, h: crop.h });
  const frameRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<string>(COLORS[0]);

  // Вырез рисуется один раз: перерисовывать его на каждый штрих незачем.
  const cropped = useMemo(() => {
    const px = clampRect(scaleRect(crop, still.scale), {
      w: still.canvas.width,
      h: still.canvas.height,
    });
    const canvas = document.createElement('canvas');
    canvas.className = 'dka__shot';
    canvas.width = Math.max(1, px.w);
    canvas.height = Math.max(1, px.h);
    canvas.getContext('2d')?.drawImage(still.canvas, px.x, px.y, px.w, px.h, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, [crop, still]);

  useEffect(() => {
    const holder = frameRef.current;
    if (!holder) return undefined;
    holder.prepend(cropped);
    return () => cropped.remove();
  }, [cropped]);

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || frame.w === 0) return;
    const dpr = sizeCanvas(canvas, frame);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const k = (frame.w / crop.w) * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Перенос выреза и масштаб показа — одной матрицей: штрихи лежат в
    // координатах всего кадра.
    ctx.setTransform(k, 0, 0, k, -crop.x * k, -crop.y * k);
    drawStrokes(ctx, strokes, 1);
  }, [crop, frame, strokes]);

  const at = useCallback(
    (event: React.PointerEvent) => {
      const box = frameRef.current?.getBoundingClientRect();
      const local = box ? pointIn(box, event, { w: crop.w, h: crop.h }) : { x: 0, y: 0 };
      return { x: local.x + crop.x, y: local.y + crop.y };
    },
    [crop],
  );

  return (
    <div className="dka">
      <div className="dka__stage" ref={stageRef}>
        <div
          className="dka__frame"
          ref={frameRef}
          style={{ width: `${frame.w}px`, height: `${frame.h}px` }}
          onPointerDown={(event) => {
            if (drawing.current) return;
            drawing.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            onChange([...strokes, startStroke(tool, color, at(event))]);
          }}
          onPointerMove={(event) => {
            if (!drawing.current) return;
            event.preventDefault();
            const last = strokes[strokes.length - 1];
            if (!last) return;
            onChange([...strokes.slice(0, -1), extendStroke(last, at(event))]);
          }}
          onPointerUp={() => {
            drawing.current = false;
          }}
          onPointerCancel={() => {
            drawing.current = false;
          }}
        >
          <canvas className="dka__overlay" ref={overlayRef} />
        </div>
      </div>

      <div className="dka__tools">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            className={`dka__tool${tool === item.id ? ' dka__tool--on' : ''}`}
            type="button"
            aria-label={item.label}
            aria-pressed={tool === item.id}
            onClick={() => setTool(item.id)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={item.icon} />
            </svg>
          </button>
        ))}

        {COLORS.map((value) => (
          <button
            key={value}
            className={`dka__color${color === value ? ' dka__color--on' : ''}`}
            type="button"
            aria-label={value}
            aria-pressed={color === value}
            style={{ background: value }}
            onClick={() => setColor(value)}
          />
        ))}

        <button
          className="dka__tool"
          type="button"
          aria-label={s.undo}
          disabled={strokes.length === 0}
          onClick={() => onChange(undoStroke(strokes))}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 14L4 9l5-5" />
            <path d="M4 9h10a6 6 0 010 12H9" />
          </svg>
        </button>
      </div>

      <footer className="dka__bar">
        <button className="dk-btn" type="button" onClick={onBack}>
          {s.back}
        </button>
        <button className="dk-btn dk-btn--main" type="button" onClick={onNext}>
          {s.next}
        </button>
      </footer>
    </div>
  );
}
