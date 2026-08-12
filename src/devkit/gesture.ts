/**
 * Скрытый жест, показывающий значок панели.
 *
 * Три пальца, удержание 800 мс, где угодно. Три одновременных касания не
 * случаются нечаянно и ни с чем в приложении не конфликтуют: долгое нажатие
 * (components/useLongPress.ts) — 480 мс одним пальцем, перетаскивание строк —
 * один указатель с захватом, вертикальный свайп Telegram выключен, зум выключен
 * через user-scalable=no.
 *
 * Слушатели за указателем только наблюдают: `passive: true` и ни одного
 * preventDefault. Инструмент отладки не имеет права сломать то, что отлаживает.
 *
 * На десктопе пальцев нет — там Ctrl+Shift+Q.
 *
 * Именно Ctrl, а не Cmd, и на макбуке тоже: Cmd+Shift+Q там выходит из системы,
 * и перехватить это нельзя — такие сочетания браузеру не отдают вовсе. Ctrl на
 * маке свободен, и одно сочетание работает на всех машинах.
 */

const FINGERS = 3;
const HOLD_MS = 800;

export function watchGesture(onFire: () => void): () => void {
  const down = new Set<number>();
  let timer: number | undefined;

  const stop = (): void => {
    window.clearTimeout(timer);
    timer = undefined;
  };

  const onPointerDown = (event: PointerEvent): void => {
    down.add(event.pointerId);
    if (down.size !== FINGERS || timer !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      // Пальцы могли разойтись за эти 800 мс — тогда это был не жест, а случайность.
      if (down.size >= FINGERS) onFire();
    }, HOLD_MS);
  };

  const onPointerUp = (event: PointerEvent): void => {
    down.delete(event.pointerId);
    if (down.size < FINGERS) stop();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    /* Сравнивается code, а не key: на русской раскладке `key` у этой клавиши
       равен «й», и сочетание переставало бы работать ровно там, где им и
       собираются пользоваться. */
    if (!event.ctrlKey || !event.shiftKey || event.altKey || event.code !== 'KeyQ') return;

    event.preventDefault();
    onFire();
  };

  const options: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener('pointerdown', onPointerDown, options);
  window.addEventListener('pointerup', onPointerUp, options);
  window.addEventListener('pointercancel', onPointerUp, options);
  /* Клавиши — на перехвате и на документе: обработчик приложения, дошедший до
     события первым, не должен решать за нас. От клиента, который забирает
     сочетание себе ещё до страницы, это не спасает — там выручает ссылка
     ?startapp=devkit, см. DevkitHost.visible. */
  document.addEventListener('keydown', onKeyDown, true);

  return () => {
    stop();
    window.removeEventListener('pointerdown', onPointerDown, options);
    window.removeEventListener('pointerup', onPointerUp, options);
    window.removeEventListener('pointercancel', onPointerUp, options);
    document.removeEventListener('keydown', onKeyDown, true);
  };
}
