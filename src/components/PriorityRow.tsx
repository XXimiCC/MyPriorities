import { memo } from 'react';

import { BlockStepper } from './BlockStepper';
import { formatHoursCompact } from '../domain/date';
import { colorOf } from '../domain/palette';
import type { PriorityStat } from '../domain/stats';
import { useLongPress } from './useLongPress';
import './PriorityRow.css';

interface Props {
  stat: PriorityStat;
  /** Сколько блоков отмечено в тот день, в который идёт запись. */
  todayBlocks: number;
  blockMinutes: number;
  onAdd(): void;
  onRemove(): void;
  onOpen(): void;
  /** Удержание на строке включает режим редактирования списка. */
  onHold(): void;
}

export const PriorityRow = memo(function PriorityRow({
  stat,
  todayBlocks,
  blockMinutes,
  onAdd,
  onRemove,
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

        <span className="prow__track">
          <span className="prow__fill" style={{ width: `${stat.fill * 100}%` }} />
        </span>
      </button>

      <BlockStepper
        blocks={todayBlocks}
        blockMinutes={blockMinutes}
        title={stat.priority.title}
        onAdd={onAdd}
        onRemove={onRemove}
      />
    </li>
  );
});
