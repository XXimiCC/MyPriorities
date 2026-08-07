import { haptics } from '../telegram/sdk';
import './Toggle.css';

interface Props {
  label: string;
  note?: string;
  checked: boolean;
  disabled?: boolean;
  onChange(next: boolean): void;
}

/** Строка с переключателем. Форма та же, что у навигационных строк настроек. */
export function Toggle({ label, note, checked, disabled, onChange }: Props): JSX.Element {
  return (
    <button
      className={`tgl${checked ? ' tgl--on' : ''}`}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        haptics.select();
        onChange(!checked);
      }}
    >
      <span className="tgl__text">
        <b>{label}</b>
        {note && <small>{note}</small>}
      </span>
      <span className="tgl__track" aria-hidden="true">
        <span className="tgl__knob" />
      </span>
    </button>
  );
}
