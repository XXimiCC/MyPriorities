import { useState } from 'react';

import { BatteryIcon } from './BatteryIcon';
import { Sheet } from './Sheet';
import { formatTime, parseTime } from '../domain/battery';
import { batteryTheme, batteryTitle } from '../domain/palette';
import { BATTERY_LEVELS, type BatteryLevel } from '../domain/types';
import { t } from '../i18n';
import { haptics } from '../telegram/sdk';
import './BatteryShiftSheet.css';

export interface EditedShift {
  /** Минута правимой отметки. undefined — добавляем новую. */
  at?: number;
  minute: number;
  level: BatteryLevel;
}

interface Props {
  shift: EditedShift | null;
  /** Подпись дня, в который идёт правка, — чтобы не путать вчера с сегодня. */
  dayLabel: string;
  /**
   * Последняя минута, которую можно отметить. У сегодняшнего дня — текущая:
   * отметка означает «уже случилось». У прошедших суток предела нет.
   */
  maxMinute?: number;
  onClose(): void;
  onSave(minute: number, level: BatteryLevel): void;
  onDelete(): void;
}

export function BatteryShiftSheet({
  shift,
  dayLabel,
  maxMinute,
  onClose,
  onSave,
  onDelete,
}: Props): JSX.Element {
  return (
    <Sheet open={Boolean(shift)} title={t('charge.shiftTitle')} onClose={onClose}>
      {/* key сбрасывает поля при переходе к другой отметке: без него в шторке
          остаётся время предыдущей. */}
      {shift && (
        <ShiftForm
          key={`${shift.at ?? 'new'}-${shift.minute}`}
          shift={shift}
          dayLabel={dayLabel}
          maxMinute={maxMinute}
          onSave={onSave}
          onDelete={onDelete}
        />
      )}
    </Sheet>
  );
}

function ShiftForm({
  shift,
  dayLabel,
  maxMinute,
  onSave,
  onDelete,
}: {
  shift: EditedShift;
  dayLabel: string;
  maxMinute?: number;
  onSave(minute: number, level: BatteryLevel): void;
  onDelete(): void;
}): JSX.Element {
  const [time, setTime] = useState(formatTime(shift.minute));
  const [level, setLevel] = useState<BatteryLevel>(shift.level);

  const minute = parseTime(time);
  /*
   * Время из будущего не отбрасывается на лету: пока набирают «19:30», строка
   * успевает побывать и «1», и «19:00». Поэтому набранное остаётся в поле,
   * а сохранение просто заперто и под полем написано почему.
   */
  const tooLate = minute !== undefined && maxMinute !== undefined && minute > maxMinute;
  const theme = batteryTheme(level);

  return (
    <div className="bshift" style={{ '--accent': theme.hex } as React.CSSProperties}>
      <p className="bshift__day">{dayLabel}</p>

      <label className="bshift__time">
        <span>{t('charge.shiftTime')}</span>
        <input
          type="time"
          value={time}
          max={maxMinute === undefined ? undefined : formatTime(maxMinute)}
          onChange={(event) => setTime(event.target.value)}
        />
      </label>

      <p className={`bshift__note${tooLate ? ' bshift__note--stop' : ''}`}>
        {t(tooLate ? 'charge.shiftFuture' : 'charge.shiftNote')}
      </p>

      <ul className="bshift__levels">
        {BATTERY_LEVELS.map((option) => {
          const active = option === level;
          return (
            <li key={option}>
              <button
                type="button"
                className={`bshift__level press${active ? ' bshift__level--on' : ''}`}
                style={{ '--accent': batteryTheme(option).hex } as React.CSSProperties}
                aria-pressed={active}
                onClick={() => {
                  haptics.select();
                  setLevel(option);
                }}
              >
                <BatteryIcon level={option} width={40} dimmed={!active} glow={active} />
                <span>{batteryTitle(option)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <button
        className="btn-accent press"
        type="button"
        disabled={minute === undefined || tooLate}
        onClick={() => {
          if (minute === undefined || tooLate) return;
          haptics.success();
          onSave(minute, level);
        }}
      >
        {t('common.save')}
      </button>

      {shift.at !== undefined && (
        <button
          className="btn-danger press"
          type="button"
          onClick={() => {
            haptics.warning();
            onDelete();
          }}
        >
          {t('charge.shiftDelete')}
        </button>
      )}
    </div>
  );
}
