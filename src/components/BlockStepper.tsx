import { t } from '../i18n';
import './BlockStepper.css';

interface Props {
  /** Сколько блоков отмечено в тот день, в который идёт запись. */
  blocks: number;
  blockMinutes: number;
  /** Название — только для голосовых подписей. */
  title: string;
  onAdd(): void;
  onRemove(): void;
}

/** Больше пяти точек в ряд не читается — дальше показываем числом. */
const MAX_DOTS = 5;

/**
 * Отметить блок и снять отметку. Общий контрол для приоритетов и навыков:
 * промахнуться по «+» одинаково легко и там, и там, и способ исправиться
 * должен быть один и тот же.
 *
 * «Минус» стоит рядом, а не прячется в шторке: снятие отметки — не редкая
 * операция и не настройка, а вторая половина того же жеста. Он всегда на
 * месте и просто гаснет на нуле — исчезай он совсем, «плюс» прыгал бы под
 * пальцем ровно в тот момент, когда по нему целятся.
 */
export function BlockStepper({ blocks, blockMinutes, title, onAdd, onRemove }: Props): JSX.Element {
  return (
    <span className="bstep">
      <button
        className="bstep__minus press"
        type="button"
        disabled={blocks === 0}
        aria-label={t('block.remove', { minutes: blockMinutes, title })}
        onClick={onRemove}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M6 12h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>

      <button
        className="bstep__plus press"
        type="button"
        aria-label={t('block.add', { minutes: blockMinutes, title })}
        onClick={onAdd}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M12 5.5v13M5.5 12h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        {blocks > 0 && (
          <span className="bstep__count">
            {blocks <= MAX_DOTS ? Array.from({ length: blocks }, (_, i) => <i key={i} />) : `${blocks}`}
          </span>
        )}
      </button>
    </span>
  );
}
