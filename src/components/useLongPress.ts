import { useCallback, useRef } from 'react';

import { haptics } from '../telegram/sdk';

const HOLD_MS = 480;
/** Столько держат, когда открывают скрытое, а не переставляют строку. */
export const SECRET_HOLD_MS = 5000;
/** Палец всегда чуть дрожит: без допуска долгое нажатие срывалось бы на скролле. */
const MOVE_TOLERANCE = 10;

export interface LongPressApi {
  handlers: {
    onPointerDown(event: React.PointerEvent): void;
    onPointerMove(event: React.PointerEvent): void;
    onPointerUp(): void;
    onPointerCancel(): void;
    onContextMenu(event: React.MouseEvent): void;
  };
  /**
   * true, если только что сработало удержание. Обработчик обычного нажатия
   * обязан вызвать это первым и выйти: иначе после удержания откроется ещё и то,
   * что открывается по короткому тапу.
   */
  wasLongPress(): boolean;
}

export function useLongPress(onLongPress: () => void, holdMs = HOLD_MS): LongPressApi {
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    origin.current = null;
  }, []);

  return {
    handlers: {
      onPointerDown(event) {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        /*
         * Захват указателя — ради мыши и трекпада. У касания он неявный, а вот
         * нажатую кнопку мыши можно увести за пределы строки: тогда pointerup
         * уходит другому элементу, cancel() не вызывается, и удержание
         * срабатывает у того, кто уже передумал. Тот же приём в useReorder.
         */
        event.currentTarget.setPointerCapture(event.pointerId);
        fired.current = false;
        origin.current = { x: event.clientX, y: event.clientY };
        timer.current = window.setTimeout(() => {
          fired.current = true;
          haptics.bump();
          onLongPress();
          cancel();
        }, holdMs);
      },
      onPointerMove(event) {
        const start = origin.current;
        if (!start) return;
        const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
        if (moved > MOVE_TOLERANCE) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onContextMenu(event) {
        // Долгое нажатие в мобильном вебвью иначе поднимает системное меню выделения.
        event.preventDefault();
      },
    },
    wasLongPress() {
      return fired.current;
    },
  };
}
