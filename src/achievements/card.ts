/**
 * Карточка достижения для шаринга.
 *
 * Оформление намеренно то же, что у обоев: чёрный фон, один неоновый акцент,
 * подписи капслоком с трекингом. Бэкенда у приложения нет, поэтому «поделиться»
 * — это картинка, которую человек отправляет сам, а не ссылка на сервер.
 */

import { drawTrackedText, glowPass, roundRect, wrapText } from '../wallpaper/canvas';

export interface CardOptions {
  width: number;
  height: number;
  title: string;
  note: string;
  /** Дата получения или подпись «ещё не открыто». */
  footer: string;
  eyebrow: string;
  accent: string;
  accentSoft: string;
  icon: string[];
}

export function renderCard(canvas: HTMLCanvasElement, options: CardOptions): void {
  const { width, height, accent, accentSoft } = options;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  // Единица композиции — как в обоях: доли, а не пиксели, иначе на другом
  // разрешении всё расползается.
  const unit = Math.min(width, height * 0.8);
  const centerX = width / 2;

  // Мягкое пятно за значком: без него неон выглядит наклейкой на чёрном.
  const halo = ctx.createRadialGradient(centerX, height * 0.36, 0, centerX, height * 0.36, unit * 0.6);
  halo.addColorStop(0, hexToRgba(accent, 0.22));
  halo.addColorStop(1, hexToRgba(accent, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, width, height);

  const badge = unit * 0.36;
  const badgeX = centerX - badge / 2;
  const badgeY = height * 0.36 - badge / 2;

  ctx.lineWidth = unit * 0.008;
  ctx.strokeStyle = accent;
  glowPass(ctx, accent, [unit * 0.05, unit * 0.11], () => {
    roundRect(ctx, badgeX, badgeY, badge, badge, badge * 0.28);
    ctx.stroke();
  });

  drawIcon(ctx, options.icon, badgeX + badge * 0.22, badgeY + badge * 0.22, badge * 0.56, accentSoft);

  // Надзаголовок — название группы капслоком, как подпись на обоях.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = hexToRgba(accent, 0.85);
  ctx.font = `600 ${unit * 0.032}px ${FONT}`;
  drawTrackedText(ctx, options.eyebrow.toUpperCase(), centerX, height * 0.58, unit * 0.014);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#f4f4f5';
  ctx.font = `600 ${unit * 0.078}px ${FONT}`;
  const titleLines = wrapText(ctx, options.title, width * 0.82);
  titleLines.forEach((line, index) => {
    ctx.fillText(line, centerX, height * 0.655 + index * unit * 0.095);
  });

  ctx.fillStyle = 'rgba(244, 244, 245, 0.55)';
  ctx.font = `400 ${unit * 0.038}px ${FONT}`;
  const noteTop = height * 0.655 + titleLines.length * unit * 0.095 + unit * 0.03;
  wrapText(ctx, options.note, width * 0.78).forEach((line, index) => {
    ctx.fillText(line, centerX, noteTop + index * unit * 0.052);
  });

  ctx.fillStyle = 'rgba(244, 244, 245, 0.34)';
  ctx.font = `600 ${unit * 0.028}px ${FONT}`;
  ctx.textAlign = 'left';
  drawTrackedText(ctx, options.footer.toUpperCase(), centerX, height * 0.93, unit * 0.012);
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Значок группы — те же пути, что и в интерфейсе, в системе координат 24×24. */
function drawIcon(
  ctx: CanvasRenderingContext2D,
  paths: string[],
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  for (const d of paths) {
    ctx.stroke(new Path2D(d));
  }
  ctx.restore();
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  const n = Number.parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
