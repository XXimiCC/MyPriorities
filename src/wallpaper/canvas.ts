/**
 * Общие примитивы рисования на canvas.
 *
 * Вынесены из render.ts, когда карточка достижения понадобилась в том же стиле,
 * что и обои: скруглённый прямоугольник, неоновое свечение и текст с трекингом
 * нужны обоим, а дублировать их — верный способ развести оформление.
 */

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Неон: несколько проходов с растущим размытием дают ядро, ореол и рассеянный след. */
export function glowPass(
  ctx: CanvasRenderingContext2D,
  color: string,
  blurs: number[],
  paint: () => void,
): void {
  ctx.save();
  ctx.shadowColor = color;
  for (const blur of blurs) {
    ctx.shadowBlur = blur;
    paint();
  }
  ctx.restore();
}

/**
 * Трекинг рисуется вручную по символам: ctx.letterSpacing появился только в
 * свежих движках, а картинка должна одинаково собираться и в старом WKWebView.
 *
 * Промежуток добавляется только МЕЖДУ буквами, поэтому надпись центрируется
 * ровно по total и никакой компенсации хвостового отступа не требует.
 */
export function measureTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  tracking: number,
): number {
  const chars = [...text];
  const glyphs = chars.reduce((sum, char) => sum + ctx.measureText(char).width, 0);
  return glyphs + tracking * Math.max(0, chars.length - 1);
}

export function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  baselineY: number,
  tracking: number,
): void {
  let cursor = centerX - measureTracked(ctx, text, tracking) / 2;
  for (const char of text) {
    ctx.fillText(char, cursor, baselineY);
    cursor += ctx.measureText(char).width + tracking;
  }
}

/** Разбивает строку по ширине. Возвращает готовые строки в порядке следования. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}
