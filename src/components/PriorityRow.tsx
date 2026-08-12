import { memo } from 'react';

import { formatHoursCompact } from '../domain/date';
import { colorOf } from '../domain/palette';
import type { PriorityStat } from '../domain/stats';
import { t } from '../i18n';
import { useLongPress } from './useLongPress';
import './PriorityRow.css';

interface Props {
  stat: PriorityStat;
  /** Сколько блоков отмечено сегодня — показывается точками у кнопки «+». */
  todayBlocks: number;
  blockMinutes: number;
  onAdd(): void;
  onOpen(): void;
  /** Удержание на строке включает режим редактирования списка. */
  onHold(): void;
}

/** Больше пяти точек в ряд не читается — дальше показываем числом. */
const MAX_DOTS = 5;

export const PriorityRow = memo(function PriorityRow({
  stat,
  todayBlocks,
  blockMinutes,
  onAdd,
  onOpen,
  onHold,
}: Props) {
  const color = colorOf(stat.priority.colorId);
  const style = { '--accent': color.hex, '--accent-soft': color.soft } as React.CSSProperties;
  const hold = useLongPress(onHold);

  return (
    <li className="prow" style={style}>
      <button
        className="prow__main"
        type="button"
        {...hold.handlers}
        onClick={() => {
          // После удержания короткий тап всё равно долетает — гасим его,
          // иначе поверх редактирования откроется ещё и шторка счётчика.
          if (hold.wasLongPress()) return;
          onOpen();
        }}
      >
        <span className="prow__head">
          <span className="prow__title">{stat.priority.title}</span>
          <span className="prow__value">{stat.minutes > 0 ? formatHoursCompact(stat.minutes) : '—'}</span>
        </span>

        <span className="bar">
          <span className="bar__fill" style={{ width: `${stat.fill * 100}%` }} />
        </span>
      </button>

      <button
        className="prow__add press"
        onClick={onAdd}
        type="button"
        aria-label={t('home.addBlock', { minutes: blockMinutes, title: stat.priority.title })}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M12 5.5v13M5.5 12h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        {todayBlocks > 0 && (
          <span className="prow__today">
            {todayBlocks <= MAX_DOTS
              ? Array.from({ length: todayBlocks }, (_, i) => <i key={i} />)
              : `${todayBlocks}`}
          </span>
        )}
      </button>
    </li>
  );
});
