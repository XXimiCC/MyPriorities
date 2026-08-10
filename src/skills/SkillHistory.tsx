import { useState } from 'react';

import { formatDayShort, formatHoursCompact, weekdayShort } from '../domain/date';
import type { DayKey } from '../domain/types';
import { t } from '../i18n';
import { haptics } from '../telegram/sdk';
import './SkillHistory.css';

interface Props {
  /** Дни от старых к новым; последний — сегодня. */
  days: DayKey[];
  /** Блоки по тем же дням и в том же порядке. */
  blocks: number[];
  blockMinutes: number;
  /**
   * С подписями дней недели, нажатием и строкой под полосой. В строке списка
   * всего этого нет: там полоса отвечает на один вопрос — было сегодня или нет.
   */
  detailed?: boolean;
}

/**
 * История навыка по дням: столбик на день, высота — сколько блоков.
 *
 * Накопленные часы и темп говорят о месяцах, а вопрос «занимался ли я сегодня»
 * оставался без ответа: у пустого дня и у навыка, к которому не притрагивались
 * полгода, вид был одинаковый. Крайний правый столбик — сегодня, и он обведён
 * всегда, даже пустой: пустая рамка и есть ответ «ещё нет».
 *
 * Глубина совпадает с лентой дописывания (BACK_DAYS): видно ровно те дни,
 * которые ещё можно закрыть. Показывать пропуск, до которого не дотянуться,
 * значит дразнить.
 *
 * Высота считается от собственного максимума навыка, а не от общего: у гитары
 * и у английского разный обычный день, и общая шкала прижала бы меньший навык
 * к нулю. Сравнивать навыки между собой полоса и не должна — у каждого свой
 * порог впереди.
 */
export function SkillHistory({ days, blocks, blockMinutes, detailed = false }: Props): JSX.Element {
  const [picked, setPicked] = useState<DayKey | null>(null);

  const max = Math.max(1, ...blocks);
  const lastIndex = days.length - 1;
  const shownIndex = picked ? days.indexOf(picked) : lastIndex;
  const shownBlocks = blocks[shownIndex] ?? 0;

  const dayLabel = (day: DayKey, value: number): string =>
    value > 0
      ? t('skills.dayTime', { day: formatDayShort(day), time: formatHoursCompact(value * blockMinutes) })
      : t('skills.dayNothing', { day: formatDayShort(day) });

  /*
   * Всё построено на span, хотя раскладка блочная: в строке списка полоса лежит
   * внутри кнопки, открывающей шторку, а кнопка принимает только строчное
   * содержимое. Один и тот же компонент в двух местах — значит и разметка одна.
   */
  return (
    <span className={`shist${detailed ? ' shist--detailed' : ''}`}>
      {/*
        Там же полоса и не нажимается — кнопка в кнопке невалидна, — поэтому дни
        остаются спанами. Скринридеру они не нужны: то же самое он прочитает
        в шторке, где полоса подробная.
      */}
      <span
        className={`shist__plot${picked ? ' shist__plot--has-pick' : ''}`}
        {...(detailed ? {} : { 'aria-hidden': true })}
      >
        {days.map((day, index) => {
          const value = blocks[index] ?? 0;
          const className = [
            'shist__cell',
            index === lastIndex ? 'shist__cell--now' : '',
            detailed && index === shownIndex ? 'shist__cell--on' : '',
          ]
            .filter(Boolean)
            .join(' ');

          // Минимум в три пикселя: доля в полпроцента иначе рисуется невидимой
          // полоской, и день с блоком выглядит как пустой.
          const bar = (
            <span className="shist__bar">
              <span
                className="shist__fill"
                style={{ height: value > 0 ? `max(3px, ${(value / max) * 100}%)` : '0' }}
              />
            </span>
          );

          return detailed ? (
            <button
              key={day}
              type="button"
              className={className}
              aria-label={dayLabel(day, value)}
              onClick={() => {
                haptics.select();
                setPicked(day === picked ? null : day);
              }}
            >
              {bar}
              <span className="shist__tick">{weekdayShort(day)}</span>
            </button>
          ) : (
            <span key={day} className={className}>
              {bar}
            </span>
          );
        })}
      </span>

      {detailed && (
        <span className="shist__caption">
          {shownIndex === lastIndex
            ? shownBlocks > 0
              ? t('skills.todayTime', { time: formatHoursCompact(shownBlocks * blockMinutes) })
              : t('skills.todayNothing')
            : dayLabel(days[shownIndex]!, shownBlocks)}
        </span>
      )}
    </span>
  );
}
