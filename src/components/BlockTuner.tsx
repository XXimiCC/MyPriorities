import { formatClock, formatHoursCompact } from '../domain/date';
import type { MarkTime } from '../domain/types';
import { t } from '../i18n';
import { haptics } from '../telegram/sdk';
import './BlockTuner.css';

interface Props {
  /** Блоки за тот день, который правим. */
  blocks: number;
  blockMinutes: number;
  /** Подпись под числом: «3 блока сегодня», «2 блока за 5 августа». */
  caption: string;
  /**
   * Стек отметок за день — только там, где время что-то значит: сегодня.
   * Отметки без времени элемента не дают: выдумывать им час нечем, а «неизвестно»
   * в строке — это шум вместо ответа.
   */
  marks?: readonly MarkTime[];
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
export function BlockTuner({
  blocks,
  blockMinutes,
  caption,
  marks,
  onAdd,
  onRemove,
}: Props): JSX.Element {
  /*
   * Порядок — тот же, что в стеке: в каком отмечали, в таком и стоят. Пересортировать
   * по времени значило бы разойтись с тем, что делает «−»: оно снимает последнюю
   * отметку стека, и она обязана быть последней и на строке.
   */
  const times = (marks ?? []).filter((minute): minute is number => minute !== null);

  return (
    <>
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

      {/* Подпись называет вещи своими именами: это время отметки, а не время
          занятия. Отмечают часто пачкой вечером, и строка не должна выглядеть
          расписанием дня. */}
      {times.length > 0 && (
        <div className="tune__marks">
          <span className="tune__marksLabel">{t('home.markTimes')}</span>
          <span className="tune__marksList">
            {times.map((minute, index) => (
              <span className="tune__mark" key={`${index}:${minute}`}>
                {formatClock(minute)}
              </span>
            ))}
          </span>
        </div>
      )}
    </>
  );
}
