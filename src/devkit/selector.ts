/**
 * Куда ткнули перед жалобой — половина «наблюдать».
 *
 * Здесь только слушатель и ссылка на элемент: этот код включён всегда, у всех,
 * с первой секунды. Разбор элемента в путь и разметку живёт в describe.ts и
 * приезжает вместе с панелью — он нужен один раз за тикет, а тикетов у
 * большинства запусков ноль.
 */

let touched: Element | undefined;

/**
 * Ссылка держится обычная, а не слабая: WeakRef появился в ES2021, а сборка
 * целится в ES2020. Держится ровно один элемент, и его заменяет следующее
 * касание — цена ничтожна.
 */
export function watchTaps(): () => void {
  const onDown = (event: PointerEvent): void => {
    const target = event.target;
    if (target instanceof Element && !target.closest('[data-devkit]')) touched = target;
  };

  const options: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener('pointerdown', onDown, options);
  return () => window.removeEventListener('pointerdown', onDown, options);
}

/** Последний тронутый элемент, если он ещё в документе. */
export function touchedElement(): Element | undefined {
  return touched?.isConnected ? touched : undefined;
}
