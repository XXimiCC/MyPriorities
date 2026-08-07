import { useMemo, useState } from 'react';

import { formatDayShort, formatMinutes, formatPercent, weekdayShort } from '../domain/date';
import { batteryTheme, batteryTitle } from '../domain/palette';
import { chargeLevel, nearestChargeLevel, type BatteryStats } from '../domain/stats';
import { BATTERY_LEVELS, type BatteryLevel, type DayKey } from '../domain/types';
import { t } from '../i18n';
import { haptics } from '../telegram/sdk';
import './EnergyChart.css';

interface Props {
  days: DayKey[];
  battery: BatteryStats;
}

const MINUTES_IN_DAY = 1440;

/**
 * Ширина системы координат фиксирована, а шаг делится между днями: картинка
 * растягивается по ширине экрана, поэтому при 7 днях и при 30 масштаб по
 * горизонтали остаётся примерно единичным и точки не расплываются в овалы.
 */
const VIEW_W = 320;
const VIEW_H = 150;
const LINE_TOP = 8;
const LINE_BOTTOM = 84;
const BARS_TOP = 100;
const BARS_BOTTOM = VIEW_H;
/** Шире этого столбик суток выглядит не столбиком, а плашкой. */
const MAX_BAR = 18;

/**
 * Снизу вверх: восстановление в основании, дальше заряд по возрастанию. Так
 * столбик читается в ту же сторону, что и линия над ним — выше значит бодрее.
 */
const STACK_ORDER: BatteryLevel[] = [4, 1, 2, 3];

export function EnergyChart({ days, battery }: Props): JSX.Element {
  const [picked, setPicked] = useState<DayKey | null>(null);

  const points = useMemo(
    () =>
      days.map((day) => {
        const minutes = battery.perDayMinutes[day] ?? { 1: 0, 2: 0, 3: 0, 4: 0 };
        const total = (Object.values(minutes) as number[]).reduce((sum, n) => sum + n, 0);
        return { day, minutes, total, charge: chargeLevel(minutes) };
      }),
    [days, battery],
  );

  // Среднее по времени, а не по дням: сутки, размеченные целиком, весят больше,
  // чем те, где отмечен один час.
  const overall = useMemo(() => chargeLevel(battery.minutes), [battery]);

  const step = VIEW_W / Math.max(days.length, 1);
  const barWidth = Math.min(MAX_BAR, step * 0.64);
  const x = (index: number): number => index * step + step / 2;
  const y = (charge: number): number => LINE_BOTTOM - charge * (LINE_BOTTOM - LINE_TOP);

  // Линия рвётся там, где заряд не отмечали, поэтому рисуем её отрезками.
  const runs: Array<Array<{ x: number; y: number }>> = [];
  points.forEach((point, index) => {
    if (point.charge === null) {
      if (runs.length > 0 && runs[runs.length - 1]!.length > 0) runs.push([]);
      return;
    }
    if (runs.length === 0) runs.push([]);
    runs[runs.length - 1]!.push({ x: x(index), y: y(point.charge) });
  });

  const selected = picked ? points.find((p) => p.day === picked) ?? null : null;
  const dense = days.length > 14;

  return (
    <div className="energy">
      <div className="energy__canvas">
      <svg
        className="energy__plot"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
      >
        {/* Ориентиры «полный» и «на нуле»: без них высота точки ни о чём не говорит. */}
        {[0, 1].map((value) => (
          <line
            key={value}
            x1={0}
            x2={VIEW_W}
            y1={y(value)}
            y2={y(value)}
            className="energy__guide"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {overall !== null && (
          <line
            x1={0}
            x2={VIEW_W}
            y1={y(overall)}
            y2={y(overall)}
            className="energy__average"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {runs.filter((run) => run.length > 0).map((run, index) => (
          <polyline
            key={index}
            className="energy__line"
            points={run.map((p) => `${p.x},${p.y}`).join(' ')}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Столбики под линией: из каких состояний сложились сутки. */}
        {points.map((point, index) => {
          let cursor = BARS_BOTTOM;
          return (
            <g key={`${point.day}-bars`} opacity={picked && picked !== point.day ? 0.45 : 1}>
              {STACK_ORDER.map((level) => {
                const share = point.minutes[level] / MINUTES_IN_DAY;
                if (share <= 0) return null;
                const height = share * (BARS_BOTTOM - BARS_TOP);
                cursor -= height;
                return (
                  <rect
                    key={level}
                    x={x(index) - barWidth / 2}
                    y={cursor}
                    width={barWidth}
                    height={height}
                    fill={batteryTheme(level).hex}
                  />
                );
              })}
            </g>
          );
        })}

        {points.map((point, index) => (
          <rect
            key={`${point.day}-hit`}
            x={index * step}
            y={0}
            width={step}
            height={VIEW_H}
            fill="transparent"
            className="energy__hit"
            role="button"
            tabIndex={0}
            aria-label={`${formatDayShort(point.day)}: ${
              point.charge === null ? t('stats.noData') : formatPercent(point.charge)
            }`}
            onClick={() => {
              haptics.select();
              setPicked(picked === point.day ? null : point.day);
            }}
          />
        ))}
      </svg>

        {/*
          Точки живут слоем поверх графика, а не внутри него.

          preserveAspectRatio="none" растягивает систему координат только по
          ширине, и <circle> в ней неизбежно превращался в эллипс: vector-effect
          спасает толщину обводки, но не форму. Проценты от размеров контейнера
          дают ту же позицию, а размер точки задаётся в пикселях и потому
          остаётся круглым при любой ширине экрана.
        */}
        <div className="energy__dots" aria-hidden="true">
          {points.map((point, index) =>
            point.charge === null ? null : (
              <span
                key={point.day}
                className={picked === point.day ? 'energy__dot energy__dot--on' : 'energy__dot'}
                style={{
                  left: `${(x(index) / VIEW_W) * 100}%`,
                  top: `${(y(point.charge) / VIEW_H) * 100}%`,
                  background: batteryTheme(nearestChargeLevel(point.charge)).hex,
                }}
              />
            ),
          )}
        </div>
      </div>

      {!dense && (
        <div className="energy__ticks">
          {days.map((day) => (
            <span key={day} className={picked === day ? 'energy__tick energy__tick--on' : 'energy__tick'}>
              {weekdayShort(day)}
            </span>
          ))}
        </div>
      )}
      {dense && (
        <div className="dstrip__axis">
          <span>{days[0] ? formatDayShort(days[0]) : ''}</span>
          <span>{days.length > 0 ? formatDayShort(days[days.length - 1]!) : ''}</span>
        </div>
      )}

      <div className="energy__legend">
        <span className="energy__legend-avg" />
        {t('stats.energyAverage')}
        {overall !== null && <b>{formatPercent(overall)}</b>}
      </div>

      {selected && (
        <div className="dbars__detail">
          <div className="dbars__detail-head">
            <b>{formatDayShort(selected.day)}</b>
            <span>
              {selected.charge !== null
                ? `${t('stats.energyLevel')} ${formatPercent(selected.charge)}`
                : // Сутки, полностью ушедшие в восстановление, — это не «нет данных»:
                  // заряда в них не измеряли, но день размечен.
                  t(selected.total > 0 ? 'stats.energyOnlyCharge' : 'stats.energyUnknown')}
            </span>
          </div>
          {selected.total === 0 ? (
            <p className="dbars__empty">{t('stats.energyDayEmpty')}</p>
          ) : (
            <ul className="dbars__list">
              {BATTERY_LEVELS.filter((level) => selected.minutes[level] > 0).map((level) => (
                <li key={level} style={{ '--accent': batteryTheme(level).hex } as React.CSSProperties}>
                  <span className="erow__swatch" />
                  <span className="dbars__name">{batteryTitle(level)}</span>
                  <span className="dbars__time">{formatMinutes(selected.minutes[level])}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
