import { useCallback, useRef, useState } from 'react';

import { haptics } from '../telegram/sdk';

/**
 * Перетаскивание элементов списка на Pointer Events.
 *
 * Библиотека сюда не тянется: список короткий (максимум десять), строки
 * одинаковой высоты, а собственная реализация даёт контроль над жестами —
 * внутри вебвью Telegram это важнее универсальности.
 *
 * Работает только при одинаковой высоте строк: смещение переводится в индекс
 * делением на высоту первой строки.
 */
export interface ReorderApi<T> {
  containerRef: React.RefObject<HTMLUListElement>;
  dragIndex: number | null;
  targetIndex: number | null;
  /** Пропсы для ручки перетаскивания. */
  handleProps(index: number): {
    onPointerDown(event: React.PointerEvent): void;
    style: React.CSSProperties;
  };
  /** Трансформация конкретной строки во время перетаскивания. */
  rowStyle(index: number): React.CSSProperties;
  move(from: number, to: number): void;
  items: T[];
}

interface DragState {
  index: number;
  startY: number;
  currentY: number;
  rowHeight: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function reorder<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

export function useReorder<T>(items: T[], onReorder: (next: T[]) => void): ReorderApi<T> {
  const containerRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // Свежий список для обработчиков, живущих между рендерами.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const targetIndex =
    drag && drag.rowHeight > 0
      ? clamp(
          drag.index + Math.round((drag.currentY - drag.startY) / drag.rowHeight),
          0,
          items.length - 1,
        )
      : null;
  const targetRef = useRef(targetIndex);
  targetRef.current = targetIndex;

  const move = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      onReorder(reorder(itemsRef.current, from, to));
    },
    [onReorder],
  );

  const handleProps = useCallback(
    (index: number) => ({
      style: { touchAction: 'none' as const },
      onPointerDown(event: React.PointerEvent) {
        if (event.button !== 0 && event.pointerType === 'mouse') return;
        const rows = containerRef.current?.children;
        const row = rows?.[index] as HTMLElement | undefined;
        if (!row) return;

        const rowHeight = row.getBoundingClientRect().height;
        const handle = event.currentTarget as HTMLElement;
        handle.setPointerCapture(event.pointerId);
        haptics.select();
        setDrag({ index, startY: event.clientY, currentY: event.clientY, rowHeight });

        const onMove = (moveEvent: PointerEvent): void => {
          moveEvent.preventDefault();
          setDrag((current) => (current ? { ...current, currentY: moveEvent.clientY } : current));
        };
        const onEnd = (): void => {
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onEnd);
          handle.removeEventListener('pointercancel', onEnd);
          const to = targetRef.current;
          if (to !== null && to !== index) {
            haptics.tap();
            move(index, to);
          }
          setDrag(null);
        };

        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onEnd);
        handle.addEventListener('pointercancel', onEnd);
      },
    }),
    [move],
  );

  const rowStyle = useCallback(
    (index: number): React.CSSProperties => {
      if (!drag || targetIndex === null) return {};

      if (index === drag.index) {
        return {
          transform: `translateY(${drag.currentY - drag.startY}px) scale(1.015)`,
          zIndex: 3,
          position: 'relative',
          transition: 'none',
        };
      }

      const { index: from } = drag;
      const shifted =
        (from < targetIndex && index > from && index <= targetIndex) ? -drag.rowHeight :
        (from > targetIndex && index < from && index >= targetIndex) ? drag.rowHeight :
        0;

      return shifted === 0 ? {} : { transform: `translateY(${shifted}px)` };
    },
    [drag, targetIndex],
  );

  return {
    containerRef,
    dragIndex: drag?.index ?? null,
    targetIndex,
    handleProps,
    rowStyle,
    move,
    items,
  };
}
