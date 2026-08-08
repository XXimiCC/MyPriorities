import { useEffect, useRef } from 'react';

import { addDays, dayKey, formatDayShort, todayKey, weekdayShort } from '../domain/date';
import type { DayKey } from '../domain/types';
import { t } from '../i18n';
import { haptics } from '../telegram/sdk';
import './DayPicker.css';

interface Props {
  /** День, который сейчас правят. */
  value: DayKey;
  /**
   * Есть ли в дне записи — под числом появляется точка. Предикат, а не журнал:
   * лента одна и та же для кликов и для отметок заряда, а «непустой день» у них
   * значит разное.
   */
  hasEntries(day: DayKey): boolean;
  onChange(day: DayKey): void;
}

/** Заполнять пропуски дальше двух недель назад смысла нет — уже не вспомнить. */
const BACK_DAYS = 14;

export function DayPicker({ value, hasEntries, onChange }: Props): JSX.Element {
  const today = todayKey();
  const now = new Date();

  // От старых к новым, сегодня справа: последний день ближе к большому пальцу.
  const days: DayKey[] = [];
  for (let back = BACK_DAYS - 1; back >= 0; back -= 1) days.push(dayKey(addDays(now, -back)));

  /*
   * Лента шире экрана вдвое, поэтому её надо домотать до конца: без этого видны
   * две недели назад, а сегодняшний день — тот, ради которого её открывают, —
   * остаётся за краем. Раньше это делал row-reverse в CSS, но он разворачивал и
   * сам порядок дней.
   */
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = strip.current;
    if (node) node.scrollLeft = node.scrollWidth;
  }, []);

  return (
    <div className="dpick" role="tablist" aria-label={t('home.dayPicker')} ref={strip}>
      {days.map((day) => {
        const marked = hasEntries(day);
        const isToday = day === today;
        return (
          <button
            key={day}
            role="tab"
            type="button"
            aria-selected={day === value}
            className={`dpick__day${marked ? ' dpick__day--marked' : ''}`}
            onClick={() => {
              if (day === value) return;
              haptics.select();
              onChange(day);
            }}
          >
            <span className="dpick__weekday">
              {isToday ? t('home.dayToday') : weekdayShort(day)}
            </span>
            <span className="dpick__num">{Number(day.slice(8, 10))}</span>
            <span className="dpick__dot" aria-hidden="true" />
            <span className="dpick__full">{formatDayShort(day)}</span>
          </button>
        );
      })}
    </div>
  );
}
