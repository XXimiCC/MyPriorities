import { formatHoursCompact } from '../domain/date';
import { t } from '../i18n';
import { haptics } from '../telegram/sdk';
import './BlockTuner.css';

interface Props {
  /** Блоки за тот день, который правим. */
  blocks: number;
  blockMinutes: number;
  /** Подпись под числом: «3 блока сегодня», «2 блока за 5 августа». */
  caption: string;
  onAdd(): void;
  onRemove(): void;
}

/**
 * Счётчик блоков за день: «−», время, «+».
 *
 * Живёт в шторке, а не в строке списка. Инлайновая пара кнопок отъедала у
 * названия сорок с лишним пикселей на каждой строке — на узком экране это
 * заметно дороже, чем лишнее касание при исправлении: отмечают каждый день,
 * а промахиваются изредка.
 *
 * Общий для приоритетов и навыков: промахнуться по «+» одинаково легко и там,
 * и там, и способ исправиться должен быть один и тот же.
 */
export function BlockTuner({ blocks, blockMinutes, caption, onAdd, onRemove }: Props): JSX.Element {
  return (
    <div className="tune">
      <button
        className="tune__btn press"
        type="button"
        disabled={blocks === 0}
        aria-label={t('home.minus', { minutes: blockMinutes })}
        onClick={() => {
          haptics.tap();
          onRemove();
        }}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M5.5 12h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>

      <div className="tune__value">
        <span className="tune__time">{formatHoursCompact(blocks * blockMinutes)}</span>
        <span className="tune__blocks">{caption}</span>
      </div>

      <button
        className="tune__btn press"
        type="button"
        aria-label={t('home.plus', { minutes: blockMinutes })}
        onClick={() => {
          haptics.tap();
          onAdd();
        }}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M12 5.5v13M5.5 12h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
