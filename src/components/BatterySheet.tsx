import { BatteryIcon } from './BatteryIcon';
import { Sheet } from './Sheet';
import { batteryTheme } from '../domain/palette';
import { BATTERY_LEVELS, type BatteryLevel } from '../domain/types';
import { haptics } from '../telegram/sdk';
import './BatterySheet.css';

interface Props {
  open: boolean;
  current: BatteryLevel | null;
  onPick(level: BatteryLevel): void;
  onClose(): void;
}

export function BatterySheet({ open, current, onPick, onClose }: Props): JSX.Element {
  return (
    <Sheet open={open} title="Сколько заряда" onClose={onClose}>
      <div className="bsheet">
        {BATTERY_LEVELS.map((level) => {
          const theme = batteryTheme(level);
          const active = current === level;
          return (
            <button
              key={level}
              className={`bsheet__item press${active ? ' bsheet__item--active' : ''}`}
              style={{ '--accent': theme.hex } as React.CSSProperties}
              type="button"
              onClick={() => {
                haptics.bump();
                onPick(level);
              }}
            >
              <BatteryIcon level={level} width={72} dimmed={!active} />
              <span className="bsheet__title">{theme.title}</span>
              <span className="bsheet__label">{theme.label}</span>
            </button>
          );
        })}
      </div>
      <p className="bsheet__hint">
        Меняйте состояние, когда оно действительно изменилось — статистика считает время между переключениями.
      </p>
    </Sheet>
  );
}
