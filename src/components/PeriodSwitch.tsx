import { haptics } from '../telegram/sdk';
import type { Period, PeriodId } from '../domain/types';
import './PeriodSwitch.css';

interface Props {
  periods: Period[];
  value: PeriodId;
  onChange(id: PeriodId): void;
}

export function PeriodSwitch({ periods, value, onChange }: Props): JSX.Element {
  return (
    <div className="pswitch" role="tablist" aria-label="Период">
      {periods.map((period) => (
        <button
          key={period.id}
          className="pswitch__item"
          role="tab"
          type="button"
          aria-selected={period.id === value}
          onClick={() => {
            if (period.id === value) return;
            haptics.select();
            onChange(period.id);
          }}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}
