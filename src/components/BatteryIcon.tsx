/**
 * Батарея из референсов, один компонент на всё приложение: шапка, шторка выбора,
 * статистика, превью обоев.
 *
 * Пропорции сняты с references/high.jpg и заданы в долях корпуса, поэтому
 * иконка одинаково честно выглядит и в 22 пикселя, и во весь экран.
 * Те же самые доли повторяет canvas-рендер обоев в wallpaper/render.ts.
 */

import { batteryTheme, batteryTitle } from '../domain/palette';
import type { BatteryLevel } from '../domain/types';
import './BatteryIcon.css';

export const BATTERY_GEOMETRY = {
  viewWidth: 112,
  viewHeight: 53,
  body: { x: 1.4, y: 1.4, w: 100, h: 50, rx: 8.5 },
  stroke: 2.4,
  nub: { w: 8.5, h: 22, rx: 3 },
  cell: { insetX: 7.5, insetY: 6.4, w: 24.8, gap: 5.3, rx: 4 },
} as const;

const G = BATTERY_GEOMETRY;
const CELL_Y = G.body.y + G.cell.insetY;
const CELL_H = G.body.h - G.cell.insetY * 2;
const CELL_X = (index: number): number => G.body.x + G.cell.insetX + index * (G.cell.w + G.cell.gap);

const NUB_Y = G.body.y + (G.body.h - G.nub.h) / 2;
const NUB_X = G.body.x + G.body.w;

/** Молния поверх залитых ячеек — единственное, что отличает зарядку от полного заряда. */
const BOLT_PATH = 'M56 9 L38.5 30.5 H49 L46 45 L63.5 23.5 H53 Z';

interface Props {
  level: BatteryLevel;
  /** Ширина в пикселях; высота считается от пропорций. */
  width?: number;
  /** Приглушённый вид для невыбранных вариантов в шторке. */
  dimmed?: boolean;
  glow?: boolean;
  title?: string;
}

export function BatteryIcon({ level, width = 34, dimmed = false, glow = true, title }: Props): JSX.Element {
  const theme = batteryTheme(level);
  const gradientId = `bat-grad-${level}`;
  const height = (width * G.viewHeight) / G.viewWidth;

  return (
    <svg
      className={`battery${glow && !dimmed ? ' battery--glow' : ''}`}
      style={{ color: theme.hex, opacity: dimmed ? 0.34 : 1 }}
      width={width}
      height={height}
      viewBox={`0 0 ${G.viewWidth} ${G.viewHeight}`}
      fill="none"
      role="img"
      aria-label={title ?? batteryTitle(level)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={theme.soft} />
          <stop offset="100%" stopColor={theme.hex} />
        </linearGradient>
      </defs>

      <rect
        x={G.body.x}
        y={G.body.y}
        width={G.body.w}
        height={G.body.h}
        rx={G.body.rx}
        stroke="currentColor"
        strokeWidth={G.stroke}
      />

      {/* Только три внешние стороны: за корпусом линия не дублируется. */}
      <path
        d={`M${NUB_X} ${NUB_Y} h${G.nub.w - G.nub.rx} a${G.nub.rx} ${G.nub.rx} 0 0 1 ${G.nub.rx} ${G.nub.rx} v${G.nub.h - G.nub.rx * 2} a${G.nub.rx} ${G.nub.rx} 0 0 1 ${-G.nub.rx} ${G.nub.rx} h${-(G.nub.w - G.nub.rx)}`}
        stroke="currentColor"
        strokeWidth={G.stroke}
        strokeLinecap="round"
      />

      {[0, 1, 2].map((index) => {
        const filled = index < theme.cells;
        return (
          <rect
            key={index}
            x={CELL_X(index)}
            y={CELL_Y}
            width={G.cell.w}
            height={CELL_H}
            rx={G.cell.rx}
            fill={filled ? `url(#${gradientId})` : 'none'}
            stroke="currentColor"
            strokeWidth={filled ? 0 : G.stroke * 0.75}
            opacity={filled ? 1 : 0.45}
          />
        );
      })}

      {theme.charging && (
        <path d={BOLT_PATH} fill="#000" stroke="currentColor" strokeWidth={G.stroke * 0.9} strokeLinejoin="round" />
      )}
    </svg>
  );
}

/** Подпись как на обоях: капс, широкий трекинг, тонкие линии по бокам. */
export function BatteryCaption({ level }: { level: BatteryLevel }): JSX.Element {
  const theme = batteryTheme(level);
  return (
    <div className="battery-caption" style={{ color: theme.hex }}>
      <span className="battery-caption__rule" />
      <span className="battery-caption__text">{theme.label}</span>
      <span className="battery-caption__rule" />
    </div>
  );
}
