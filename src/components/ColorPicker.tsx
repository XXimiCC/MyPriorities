import { NEON_PALETTE } from '../domain/palette';
import { haptics } from '../telegram/sdk';
import './ColorPicker.css';

interface Props {
  /** Индекс в NEON_PALETTE. Отрицательное значение — цвет ещё не выбран. */
  value: number;
  onChange(colorId: number): void;
}

/** Палитра из десяти неоновых цветов. Общая для приоритетов и навыков. */
export function ColorPicker({ value, onChange }: Props): JSX.Element {
  return (
    <div className="picker">
      {NEON_PALETTE.map((color, index) => (
        <button
          key={color.hex}
          type="button"
          className={`picker__dot${index === value ? ' picker__dot--on' : ''}`}
          style={{ '--accent': color.hex } as React.CSSProperties}
          aria-label={color.name}
          aria-pressed={index === value}
          onClick={() => {
            haptics.select();
            onChange(index);
          }}
        />
      ))}
    </div>
  );
}
