/**
 * Короткое сообщение об исходе отправки.
 *
 * Появилось не для красоты. Пока панель просто закрывалась после «Отправить»,
 * успешная отправка и отложенная в очередь выглядели одинаково — и тикет,
 * который не доехал, ничем не отличался от доехавшего. Два потерянных отчёта
 * обнаружились только при взгляде в базу, и это ровно та цена, которую платят
 * за молчаливый интерфейс.
 *
 * Живёт вне React намеренно: панель к этому моменту уже закрыта, а сообщение
 * должно её пережить. Голый DOM в том же контейнере, что и пусковая кнопка.
 */

import { MARK } from './mount';

const SHOWN_MS = { ok: 4200, warn: 7000 };

const BASE = [
  'position:fixed',
  'left:50%',
  'transform:translateX(-50%)',
  'bottom:calc(16px + var(--tabbar-h, 0px) + var(--safe-bottom, env(safe-area-inset-bottom, 0px)))',
  'max-width:min(92vw, 420px)',
  'padding:10px 14px',
  'border-radius:12px',
  'background:rgba(8,9,11,.94)',
  'backdrop-filter:blur(10px)',
  '-webkit-backdrop-filter:blur(10px)',
  'font:500 13px/1.35 system-ui,-apple-system,sans-serif',
  'text-align:center',
  // Сообщение не перехватывает касания: оно ничего не делает, только сообщает.
  'pointer-events:none',
  'z-index:2',
].join(';');

const TONE = {
  ok: 'color:#35e0ff;border:1px solid rgba(53,224,255,.45);box-shadow:0 0 16px rgba(53,224,255,.25)',
  warn: 'color:#ffc46b;border:1px solid rgba(255,196,107,.45);box-shadow:0 0 16px rgba(255,196,107,.2)',
};

export function toast(text: string, tone: 'ok' | 'warn' = 'ok'): void {
  const host = document.querySelector(`[${MARK}]`);
  if (!host) return;

  // Второе сообщение вытесняет первое: их никогда не бывает два разом, а
  // наложение читалось бы как одно испорченное.
  host.querySelector('[data-devkit-toast]')?.remove();

  const node = document.createElement('div');
  node.setAttribute('data-devkit-toast', '');
  node.setAttribute('role', 'status');
  node.textContent = text;
  node.style.cssText = `${BASE};${TONE[tone]}`;
  host.append(node);

  window.setTimeout(() => node.remove(), SHOWN_MS[tone]);
}
