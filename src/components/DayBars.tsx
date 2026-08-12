import { useState } from 'react';

import { formatDayShort, formatHoursCompact, weekdayShort } from '../domain/date';
import { colorOf } from '../domain/palette';
import type { DailyBreakdown } from '../domain/stats';
import { t } from '../i18n';
import { haptics } from '../telegram/sdk';
import './DayBars.css';

interface Props {
  breakdown: DailyBreakdown;
  /** Минуты в одном блоке — для подписи выбранного дня. */
  blockMinutes: number;
}

/** Ниже этого сегмент превращается в невидимую полоску в доли пикселя. */
const MIN_SEGMENT = 3;

/**
 * Столбики по дням: высота — сколько блоков в этот день, цвета внутри — из чего
 * они сложились. Сумма и состав в одном месте: по одним только суммам за период
 * не видно, ровно вы жили или всё выгребли за два дня.
 */
export function DayBars({ breakdown, blockMinutes }: Props): JSX.Element {
  const [picked, setPicked] = useState<string | null>(null);

  const { columns, maxBlocks } = breakdown;
  const selected = columns.find((c) => c.day === picked) ?? null;
  // Пока день не выбран, подписываем последний непустой — так подпись не пустует.
  const shown = selected ?? [...columns].reverse().find((c) => c.blocks > 0) ?? null;
  const dense = columns.length > 14;

  return (
    <div className="dbars">
      <div
        className={`dbars__plot${dense ? ' dbars__plot--dense' : ''}${picked ? ' dbars__plot--has-pick' : ''}`}
      >
        {columns.map((column) => {
          const active = shown?.day === column.day;
          return (
            <button
              key={column.day}
              type="button"
              className={`dbars__col${active ? ' dbars__col--on' : ''}`}
              aria-label={`${formatDayShort(column.day)}: ${formatHoursCompact(column.blocks * blockMinutes)}`}
              onClick={() => {
                haptics.select();
                setPicked(column.day === picked ? null : column.day);
              }}
            >
              <span className="dbars__stack">
                {column.segments.map((segment) => {
                  const share = maxBlocks > 0 ? segment.blocks / maxBlocks : 0;
                  const color = colorOf(segment.priority.colorId);
                  return (
                    <span
                      key={segment.priority.id}
                      className="dbars__seg"
                      style={{
                        height: `max(${MIN_SEGMENT}px, ${share * 100}%)`,
                        background: color.hex,
                        boxShadow: `0 0 6px ${color.hex}`,
                      }}
                    />
                  );
                })}
              </span>
              {!dense && <span className="dbars__tick">{weekdayShort(column.day)}</span>}
            </button>
          );
        })}
      </div>

      {dense && (
        <div className="dstrip__axis">
          <span>{columns[0] ? formatDayShort(columns[0].day) : ''}</span>
          <span>{columns.length > 0 ? formatDayShort(columns[columns.length - 1]!.day) : ''}</span>
        </div>
      )}

      {shown && (
        <div className="dbars__detail">
          <div className="dbars__detail-head">
            <b>{formatDayShort(shown.day)}</b>
            <span>{formatHoursCompact(shown.blocks * blockMinutes)}</span>
          </div>
          {shown.blocks === 0 ? (
            <p className="dbars__empty">{t('stats.dayEmpty')}</p>
          ) : (
            <ul className="dbars__list">
              {shown.segments.map((segment) => (
                <li
                  key={segment.priority.id}
                  style={{ '--accent': colorOf(segment.priority.colorId).hex } as React.CSSProperties}
                >
                  <span className="swatch" />
                  <span className="dbars__name">{segment.priority.title}</span>
                  <span className="dbars__time">
                    {formatHoursCompact(segment.blocks * blockMinutes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
