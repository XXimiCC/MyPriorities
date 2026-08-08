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
  onClose(): void;
  onSave(minute: number, level: BatteryLevel): void;
  onDelete(): void;
}

export function BatteryShiftSheet({ shift, dayLabel, onClose, onSave, onDelete }: Props): JSX.Element {
  return (
    <Sheet open={Boolean(shift)} title={t('charge.shiftTitle')} onClose={onClose}>
      {/* key сбрасывает поля при переходе к другой отметке: без него в шторке
          остаётся время предыдущей. */}
      {shift && (
        <ShiftForm
          key={`${shift.at ?? 'new'}-${shift.minute}`}
          shift={shift}
          dayLabel={dayLabel}
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
  onSave,
  onDelete,
}: {
  shift: EditedShift;
  dayLabel: string;
  onSave(minute: number, level: BatteryLevel): void;
  onDelete(): void;
}): JSX.Element {
  const [time, setTime] = useState(formatTime(shift.minute));
  const [level, setLevel] = useState<BatteryLevel>(shift.level);

  const minute = parseTime(time);
  const theme = batteryTheme(level);

  return (
    <div className="bshift" style={{ '--accent': theme.hex } as React.CSSProperties}>
      <p className="bshift__day">{dayLabel}</p>

      <label className="bshift__time">
        <span>{t('charge.shiftTime')}</span>
        <input
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
        />
      </label>

      <p className="bshift__note">{t('charge.shiftNote')}</p>

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
        className="pform__submit press"
        type="button"
        disabled={minute === undefined}
        onClick={() => {
          if (minute === undefined) return;
          haptics.success();
          onSave(minute, level);
        }}
      >
        {t('common.save')}
      </button>

      {shift.at !== undefined && (
        <button
          className="bshift__delete press"
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
