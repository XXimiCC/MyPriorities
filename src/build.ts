/**
 * Кто именно сейчас открыт.
 *
 * Значения подставляются сборщиком (см. `define` в vite.config.ts), поэтому в
 * тестах и в dev их может не быть вовсе — отсюда проверка на объявленность.
 */

declare const __BUILD_ID__: string | undefined;
declare const __BUILD_TIME__: string | undefined;

function value(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw ? raw : fallback;
}

/** Короткий хеш коммита. */
export const BUILD_ID = value(typeof __BUILD_ID__ === 'undefined' ? undefined : __BUILD_ID__, 'dev');

/** Время сборки в ISO. Пустая строка — сборки как таковой не было. */
export const BUILD_TIME = value(
  typeof __BUILD_TIME__ === 'undefined' ? undefined : __BUILD_TIME__,
  '',
);

/**
 * `abc1234 · 09.08 13:40` — коротко и достаточно, чтобы сверить с тем, что
 * ожидалось. Время местное: сверять его будут по своим часам.
 */
export function buildLabel(): string {
  if (!BUILD_TIME) return BUILD_ID;
  const at = new Date(BUILD_TIME);
  if (Number.isNaN(at.getTime())) return BUILD_ID;

  const two = (value: number): string => String(value).padStart(2, '0');
  const when = `${two(at.getDate())}.${two(at.getMonth() + 1)} ${two(at.getHours())}:${two(at.getMinutes())}`;
  return `${BUILD_ID} · ${when}`;
}
