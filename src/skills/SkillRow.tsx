import { memo } from 'react';

import { formatHoursCompact } from '../domain/date';
import { colorOf } from '../domain/palette';
import type { DayKey } from '../domain/types';
import { t } from '../i18n';
import { levelTitle } from './levels';
import { SkillHistory } from './SkillHistory';
import type { SkillTotal } from './total';
import './SkillRow.css';

interface Props {
  total: SkillTotal;
  /** Блоки того дня, в который идёт запись, — их и показывает точка у «+». */
  dayBlocks: number;
  /** Сколько вложено за окно темпа — без стартового капитала. */
  recentMinutes: number;
  /** Дни полосы истории и блоки по ним — от старых к новым. */
  historyDays: DayKey[];
  historyBlocks: number[];
  blockMinutes: number;
  onAdd(): void;
  onOpen(): void;
}

/**
 * Строка навыка. От строки приоритета отличается тем, что полоса заполняется не
 * относительно лидера, а относительно следующей ступени: у навыка нет соперников,
 * есть только следующий порог.
 */
export const SkillRow = memo(function SkillRow({
  total,
  dayBlocks,
  recentMinutes,
  historyDays,
  historyBlocks,
  blockMinutes,
  onAdd,
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

        <span className="bar bar--thin">
          <span className="bar__fill" style={{ width: `${progress.fraction * 100}%` }} />
        </span>

        {/* Полоса дней идёт сразу под полосой прогресса: одна отвечает «сколько
            всего», другая — «а на этой неделе». Обе про одно и то же время. */}
        <SkillHistory days={historyDays} blocks={historyBlocks} blockMinutes={blockMinutes} />

        <span className="srow__foot">
          <span className="srow__hours">{formatHoursCompact(progress.minutes)}</span>
          {recentMinutes > 0 && (
            <span className="srow__recent">+{formatHoursCompact(recentMinutes)}</span>
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

      <button
        className="srow__add press"
        type="button"
        aria-label={t('skills.addBlock', { minutes: blockMinutes, title: total.skill.title })}
        onClick={onAdd}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M12 5.5v13M5.5 12h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        {dayBlocks > 0 && <span className="srow__today">{dayBlocks}</span>}
      </button>
    </li>
  );
});

/** Пятизначные пороги без разделителя читаются как случайный набор цифр. */
export function formatNumber(value: number): string {
  return value >= 10_000 ? value.toLocaleString('ru-RU') : String(value);
}
