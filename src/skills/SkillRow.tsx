import { memo } from 'react';

import { BlockStepper } from '../components/BlockStepper';
import { formatHoursCompact } from '../domain/date';
import { colorOf } from '../domain/palette';
import { t } from '../i18n';
import { levelTitle } from './levels';
import type { SkillTotal } from './total';
import './SkillRow.css';

interface Props {
  total: SkillTotal;
  todayBlocks: number;
  /** Сколько вложено за выбранный период — без стартового капитала. */
  periodMinutes: number;
  blockMinutes: number;
  onAdd(): void;
  onRemove(): void;
  onOpen(): void;
}

/**
 * Строка навыка. От строки приоритета отличается тем, что полоса заполняется не
 * относительно лидера, а относительно следующей ступени: у навыка нет соперников,
 * есть только следующий порог.
 */
export const SkillRow = memo(function SkillRow({
  total,
  todayBlocks,
  periodMinutes,
  blockMinutes,
  onAdd,
  onRemove,
  onOpen,
}: Props) {
  const color = colorOf(total.skill.colorId);
  const style = { '--accent': color.hex, '--accent-soft': color.soft } as React.CSSProperties;
  const { progress } = total;

  return (
    <li className="srow" style={style}>
      <button className="srow__main" type="button" onClick={onOpen}>
        <span className="srow__head">
          <span className="srow__title">{total.skill.title}</span>
          <span className="srow__level">{levelTitle(progress.level)}</span>
        </span>

        <span className="srow__track">
          <span className="srow__fill" style={{ width: `${progress.fraction * 100}%` }} />
        </span>

        <span className="srow__foot">
          <span className="srow__hours">{formatHoursCompact(progress.minutes)}</span>
          {periodMinutes > 0 && (
            <span className="srow__period">+{formatHoursCompact(periodMinutes)}</span>
          )}
          {progress.next && (
            <span className="srow__next">
              {t('level.threshold', {
                hours: formatNumber(progress.next.hours),
                unit: 'ч',
              })}
            </span>
          )}
        </span>
      </button>

      <BlockStepper
        blocks={todayBlocks}
        blockMinutes={blockMinutes}
        title={total.skill.title}
        onAdd={onAdd}
        onRemove={onRemove}
      />
    </li>
  );
});

/** Пятизначные пороги без разделителя читаются как случайный набор цифр. */
export function formatNumber(value: number): string {
  return value >= 10_000 ? value.toLocaleString('ru-RU') : String(value);
}
