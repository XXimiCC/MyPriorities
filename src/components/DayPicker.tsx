import { addDays, dayKey, formatDayShort, todayKey, weekdayShort } from '../domain/date';
import type { Journal, DayKey } from '../domain/types';
import { t } from '../i18n';
import { haptics } from '../telegram/sdk';
import './DayPicker.css';

interface Props {
  /** День, в который сейчас пишутся клики. */
  value: DayKey;
  journal: Journal;
  onChange(day: DayKey): void;
}

/** Заполнять пропуски дальше двух недель назад смысла нет — уже не вспомнить. */
const BACK_DAYS = 14;

export function DayPicker({ value, journal, onChange }: Props): JSX.Element {
  const today = todayKey();
  const now = new Date();

  // От старых к новым, сегодня справа: последний день ближе к большому пальцу.
  const days: DayKey[] = [];
  for (let back = BACK_DAYS - 1; back >= 0; back -= 1) days.push(dayKey(addDays(now, -back)));

  return (
    <div className="dpick" role="tablist" aria-label={t('home.dayPicker')}>
      {days.map((day) => {
        const entry = journal.clicks[day];
        const marked = Boolean(entry && Object.values(entry).some((n) => n > 0));
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
