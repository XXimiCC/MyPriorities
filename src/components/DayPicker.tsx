import { useEffect, useRef } from 'react';

import { addDays, dayKey, formatDayShort, todayKey, weekdayShort } from '../domain/date';
import type { DayKey } from '../domain/types';
import { t } from '../i18n';
import { haptics } from '../telegram/sdk';
import { revealInStrip } from './strip';
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

/**
 * Заполнять пропуски дальше двух недель назад смысла нет — уже не вспомнить.
 *
 * Экспортируется, потому что этот горизонт разделяет полоса истории навыка:
 * там видно ровно те дни, которые здесь ещё можно дописать. Разъехавшись, эти
 * два числа означали бы «вижу пропуск, а закрыть его нечем».
 */
export const BACK_DAYS = 14;

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
            onClick={(event) => {
              // Сначала лента, потом выбор: подрезанный краем день надо
              // довести до видимости, даже если он уже выбран.
              revealInStrip(event.currentTarget);
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

/**
 * Кнопка, раскрывающая ленту. Живёт рядом с самой лентой, а не на экране:
 * её делят главная и навыки, и разъехаться значку с подписью нельзя.
 */
export function DayPickerToggle({ open, onToggle }: { open: boolean; onToggle(): void }): JSX.Element {
  return (
    <button className="dpick__toggle press" type="button" onClick={onToggle}>
      {open ? (
        t('home.hidePicker')
      ) : (
        <>
          {/* Стрелка против часовой: вернуться назад по времени и дописать. */}
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
            <path
              d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M3 3v5h5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t('home.fillGaps')}
        </>
      )}
    </button>
  );
}

/** Напоминание, что клики уходят не в сегодня, и выход из режима. */
export function PastDayNotice({ day, onBack }: { day: DayKey; onBack(): void }): JSX.Element {
  return (
    <div className="dpast">
      <span>{t('home.pastWarning', { day: formatDayShort(day) })}</span>
      <button
        type="button"
        onClick={() => {
          haptics.tap();
          onBack();
        }}
      >
        {t('home.backToToday')}
      </button>
    </div>
  );
}
