import { useEffect, useState } from 'react';

import { Sheet } from './Sheet';
import { colorOf } from '../domain/palette';
import type { Priority } from '../domain/types';
import { t } from '../i18n';
import { haptics } from '../telegram/sdk';
import './DrainSheet.css';

interface Props {
  open: boolean;
  priorities: Priority[];
  /** id приоритета либо пустая строка, если ответ «не знаю». */
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

  useEffect(() => {
    if (!open) return undefined;
    setLeft(SKIP_DELAY_SECONDS);

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
              <span className="erow__swatch" />
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
              onAnswer('');
            }}
          >
            {t('drain.other')}
          </button>
        </li>
      </ul>

      <button className="drain__skip" type="button" disabled={!canSkip} onClick={onSkip}>
        {t('drain.skip')}
        {!canSkip && <span className="drain__count">{left}</span>}
      </button>
    </Sheet>
  );
}
