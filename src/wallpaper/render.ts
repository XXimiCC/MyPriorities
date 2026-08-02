/**
 * Отрисовка обоев на canvas.
 *
 * Все размеры — доли от «единицы композиции», а не от ширины холста:
 * unit = min(width, height × 9/16). Благодаря этому кадр 9:16 повторяет
 * references/{high,mid,low}.jpg один в один, а на широком экране композиция
 * не раздувается, а остаётся вписанной по центру.
 *
 * Числа ниже сняты с референса 941×1672 и переведены в доли:
 *   корпус  530×275 при ширине 941  → 0.563 ширины, отношение сторон 0.519
 *   центр   по y на 977 из 1672     → 0.585 высоты
 *   подпись на 1232 из 1672         → 0.124 unit ниже корпуса
 *   кегль   ~34 px                  → 0.036 unit, трекинг 0.41 em
 */

import { batteryTheme } from '../domain/palette';
import type { BatteryLevel } from '../domain/types';

const REF = {
  bodyWidth: 0.563,
  bodyAspect: 275 / 530,
  centerY: 0.585,
  strokeWidth: 11 / 530,
  bodyRadius: 45 / 530,
  nubWidth: 45 / 530,
  nubHeight: 125 / 275,
  nubRadius: 16 / 530,
  cellInsetX: 40 / 530,
  cellGap: 28 / 530,
  cellInsetY: 35 / 275,
  cellRadius: 18 / 530,
  labelOffset: 0.124,
  labelSize: 0.036,
  labelTracking: 0.41,
  ruleLength: 0.159,
  ruleGap: 0.027,
  glowRadius: 0.95,
} as const;

export interface WallpaperOptions {
  width: number;
  height: number;
  level: BatteryLevel;
  /** Подпись HIGH / MEDIUM / LOW / CHARGING под батареей, как в референсах. */
  showLabel?: boolean;
}

export interface WallpaperSkin {
  id: string;
  name: string;
  draw(ctx: CanvasRenderingContext2D, options: WallpaperOptions): void;
}

function roundRect(
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
function glowPass(
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
 * свежих движках, а обои должны одинаково собираться и в старом WKWebView.
 *
 * Промежуток добавляется только МЕЖДУ буквами, поэтому надпись центрируется
 * ровно по total и никакой компенсации хвостового отступа не требует.
 */
function measureTracked(ctx: CanvasRenderingContext2D, text: string, tracking: number): number {
  const chars = [...text];
  const glyphs = chars.reduce((sum, char) => sum + ctx.measureText(char).width, 0);
  return glyphs + tracking * Math.max(0, chars.length - 1);
}

function drawTrackedText(
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

export const neonSkin: WallpaperSkin = {
  id: 'neon',
  name: 'Неон',

  draw(ctx, { width, height, level, showLabel = true }) {
    const theme = batteryTheme(level);
    const unit = Math.min(width, height * (9 / 16));

    const bodyW = unit * REF.bodyWidth;
    const bodyH = bodyW * REF.bodyAspect;
    const stroke = bodyW * REF.strokeWidth;
    const centerX = width / 2;
    const centerY = height * REF.centerY;
    const bodyX = centerX - bodyW / 2;
    const bodyY = centerY - bodyH / 2;

    // --- Фон и общий подсвет ---
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, unit * REF.glowRadius);
    glow.addColorStop(0, `${theme.hex}26`);
    glow.addColorStop(0.45, `${theme.hex}0f`);
    glow.addColorStop(1, `${theme.hex}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    // --- Носик: три внешние стороны, чтобы линия не двоилась на корпусе ---
    const nubW = bodyW * REF.nubWidth;
    const nubH = bodyH * REF.nubHeight;
    const nubR = bodyW * REF.nubRadius;
    const nubY = centerY - nubH / 2;
    const nubX = bodyX + bodyW;

    const strokeNub = (): void => {
      ctx.beginPath();
      ctx.moveTo(nubX, nubY);
      ctx.lineTo(nubX + nubW - nubR, nubY);
      ctx.arcTo(nubX + nubW, nubY, nubX + nubW, nubY + nubR, nubR);
      ctx.lineTo(nubX + nubW, nubY + nubH - nubR);
      ctx.arcTo(nubX + nubW, nubY + nubH, nubX + nubW - nubR, nubY + nubH, nubR);
      ctx.lineTo(nubX, nubY + nubH);
      ctx.stroke();
    };

    ctx.strokeStyle = theme.hex;
    ctx.lineWidth = stroke;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const strokeBody = (): void => {
      roundRect(ctx, bodyX, bodyY, bodyW, bodyH, bodyW * REF.bodyRadius);
      ctx.stroke();
    };

    glowPass(ctx, theme.hex, [stroke * 1.2, stroke * 3.4, stroke * 8], () => {
      strokeBody();
      strokeNub();
    });
    strokeBody();
    strokeNub();

    // --- Ячейки ---
    const insetX = bodyW * REF.cellInsetX;
    const gap = bodyW * REF.cellGap;
    const insetY = bodyH * REF.cellInsetY;
    const cellW = (bodyW - insetX * 2 - gap * 2) / 3;
    const cellH = bodyH - insetY * 2;
    const cellY = bodyY + insetY;
    const cellR = bodyW * REF.cellRadius;

    const fill = ctx.createLinearGradient(0, cellY, 0, cellY + cellH);
    fill.addColorStop(0, theme.soft);
    fill.addColorStop(1, theme.hex);

    for (let index = 0; index < 3; index += 1) {
      const x = bodyX + insetX + index * (cellW + gap);
      const path = (): void => roundRect(ctx, x, cellY, cellW, cellH, cellR);

      if (index < theme.cells) {
        ctx.fillStyle = fill;
        glowPass(ctx, theme.hex, [stroke * 2, stroke * 5], () => {
          path();
          ctx.fill();
        });
        path();
        ctx.fill();
      } else {
        // Пустая ячейка — только контур вполсилы, как в mid.jpg и low.jpg.
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = stroke * 0.75;
        path();
        ctx.stroke();
        ctx.restore();
      }
    }

    if (theme.charging) drawBolt(ctx, centerX, centerY, bodyH, stroke, theme.hex);

    // --- Подпись между двумя линиями ---
    if (!showLabel) return;

    const fontSize = unit * REF.labelSize;
    const baselineY = bodyY + bodyH + unit * REF.labelOffset;
    ctx.font = `500 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = theme.hex;

    const tracking = fontSize * REF.labelTracking;
    const textWidth = measureTracked(ctx, theme.label, tracking);

    glowPass(ctx, theme.hex, [fontSize * 0.35, fontSize * 1.1], () => {
      drawTrackedText(ctx, theme.label, centerX, baselineY, tracking);
    });
    drawTrackedText(ctx, theme.label, centerX, baselineY, tracking);

    const ruleLength = unit * REF.ruleLength;
    const ruleGap = unit * REF.ruleGap;
    // Линии идут по середине прописных: их высота примерно 0.7 кегля от базовой линии.
    const ruleY = baselineY - fontSize * 0.34;

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1, unit * 0.0014);
    ctx.beginPath();
    ctx.moveTo(centerX - textWidth / 2 - ruleGap - ruleLength, ruleY);
    ctx.lineTo(centerX - textWidth / 2 - ruleGap, ruleY);
    ctx.moveTo(centerX + textWidth / 2 + ruleGap, ruleY);
    ctx.lineTo(centerX + textWidth / 2 + ruleGap + ruleLength, ruleY);
    ctx.stroke();
    ctx.restore();
  },
};

function drawBolt(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  bodyH: number,
  stroke: number,
  color: string,
): void {
  // Те же координаты, что у BOLT_PATH в BatteryIcon: молния вписана в корпус 53 единиц высотой.
  const scale = bodyH / 53;
  const points: Array<[number, number]> = [
    [56, 9],
    [38.5, 30.5],
    [49, 30.5],
    [46, 45],
    [63.5, 23.5],
    [53, 23.5],
  ];

  // Координаты пути переводятся текущей матрицей в момент построения, поэтому
  // restore() до заливки корректен: контур уже абсолютный, а толщина обводки
  // остаётся в исходных единицах и не масштабируется вместе с молнией.
  ctx.save();
  ctx.translate(centerX - 51.4 * scale, centerY - 26.5 * scale);
  ctx.scale(scale, scale);
  ctx.beginPath();
  points.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.restore();

  ctx.fillStyle = '#000000';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = stroke * 0.9;
  ctx.lineJoin = 'round';
  glowPass(ctx, color, [stroke * 2, stroke * 5], () => ctx.stroke());
  ctx.stroke();
}

/** Реестр скинов: новый дизайн батареи добавляется сюда одним объектом. */
export const WALLPAPER_SKINS: WallpaperSkin[] = [neonSkin];

export function renderWallpaper(canvas: HTMLCanvasElement, options: WallpaperOptions, skinId = 'neon'): void {
  const skin = WALLPAPER_SKINS.find((s) => s.id === skinId) ?? neonSkin;
  canvas.width = Math.round(options.width);
  canvas.height = Math.round(options.height);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  skin.draw(ctx, { ...options, width: canvas.width, height: canvas.height });
}
