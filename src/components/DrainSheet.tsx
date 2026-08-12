import { useEffect, useState } from 'react';

import { Sheet } from './Sheet';
import { batteryTheme, colorOf } from '../domain/palette';
import {
  DRAIN_TEXT_MAX,
  DRAIN_UNKNOWN,
  drainCustom,
  type Priority,
} from '../domain/types';
import { t } from '../i18n';
import { haptics } from '../telegram/sdk';
import './DrainSheet.css';

interface Props {
  open: boolean;
  priorities: Priority[];
  /**
   * id приоритета, DRAIN_UNKNOWN («не знаю») либо ответ своими словами
   * с префиксом DRAIN_TEXT_PREFIX.
   */
  onAnswer(drainedBy: string): void;
  onSkip(): void;
}

/**
 * Сколько секунд вопрос нельзя пропустить.
 *
 * Само окно не закрывается — оно ждёт ответа. Пауза нужна, чтобы «пропустить»
 * не нажималось рефлекторно, вместе с тем же тапом, которым только что выбрали
 * «на нуле»: кнопка появляется там, где палец уже находится.
 * Ответить можно сразу, задержка касается только пропуска.
 */
const SKIP_DELAY_SECONDS = 3;

export function DrainSheet({ open, priorities, onAnswer, onSkip }: Props): JSX.Element {
  const [left, setLeft] = useState(SKIP_DELAY_SECONDS);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    setLeft(SKIP_DELAY_SECONDS);
    // Недописанный ответ не должен всплыть в следующем вопросе — там он был бы
    // про другой день и другую усталость.
    setText('');

    const tick = window.setInterval(() => {
      setLeft((value) => {
        if (value <= 1) {
          window.clearInterval(tick);
          return 0;
        }
        return value - 1;
      });
    }, 1000);

    return () => window.clearInterval(tick);
  }, [open]);

  const canSkip = left === 0;
  const custom = drainCustom(text);
  // Пока отсчёт идёт, закрыть шторку нечем: ни фоном, ни системной «назад».
  // Иначе задержка на кнопке ничего не значила бы.
  const handleClose = (): void => {
    if (canSkip) onSkip();
  };

  return (
    <Sheet open={open} title={t('drain.title')} onClose={handleClose}>
      <p className="drain__hint">{t('drain.hint')}</p>

      <ul className="drain__list">
        {priorities.map((priority) => (
          <li key={priority.id}>
            <button
              className="drain__item press"
              style={{ '--accent': colorOf(priority.colorId).hex } as React.CSSProperties}
              type="button"
              onClick={() => {
                haptics.bump();
                onAnswer(priority.id);
              }}
            >
              <span className="swatch" />
              {priority.title}
            </button>
          </li>
        ))}
        <li>
          <button
            className="drain__item drain__item--muted press"
            type="button"
            onClick={() => {
              haptics.tap();
              onAnswer(DRAIN_UNKNOWN);
            }}
          >
            {t('drain.other')}
          </button>
        </li>
      </ul>

      {/* Своими словами — про то, чего в приоритетах нет: чужая просьба, дорога,
          бессонная ночь. Одинаковые ответы сложатся в статистике в одну строку. */}
      <form
        className="drain__own"
        style={{ '--accent': batteryTheme(1).hex } as React.CSSProperties}
        onSubmit={(event) => {
          event.preventDefault();
          if (!custom) return;
          haptics.bump();
          onAnswer(custom);
        }}
      >
        <input
          className="field"
          type="text"
          value={text}
          maxLength={DRAIN_TEXT_MAX}
          placeholder={t('drain.ownPlaceholder')}
          aria-label={t('drain.own')}
          onChange={(event) => setText(event.target.value)}
        />
        <button className="drain__send press" type="submit" disabled={!custom} aria-label={t('drain.ownSend')}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
            <path
              d="M5 12h13M12.5 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>

      <button className="drain__skip" type="button" disabled={!canSkip} onClick={onSkip}>
        {t('drain.skip')}
        {!canSkip && <span className="drain__count">{left}</span>}
      </button>
    </Sheet>
  );
}
