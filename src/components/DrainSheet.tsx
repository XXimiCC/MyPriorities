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
 * Столько секунд вопрос ждёт ответа, прежде чем закрыться сам.
 *
 * Он всплывает в худший момент: человек только что признался, что выжат.
 * Модалка, которую надо закрывать руками, в такой момент раздражает больше,
 * чем помогает, поэтому бездействие — это тоже ответ, и он засчитывается
 * как пропуск.
 */
const AUTO_SKIP_SECONDS = 3;

export function DrainSheet({ open, priorities, onAnswer, onSkip }: Props): JSX.Element {
  const [left, setLeft] = useState(AUTO_SKIP_SECONDS);

  useEffect(() => {
    if (!open) return undefined;
    setLeft(AUTO_SKIP_SECONDS);

    const tick = window.setInterval(() => {
      setLeft((value) => {
        if (value <= 1) {
          window.clearInterval(tick);
          onSkip();
          return 0;
        }
        return value - 1;
      });
    }, 1000);

    return () => window.clearInterval(tick);
  }, [open, onSkip]);

  // Любое касание списка снимает автозакрытие: человек начал отвечать.
  const stopCountdown = (): void => setLeft(0);

  return (
    <Sheet open={open} title={t('drain.title')} onClose={onSkip}>
      <p className="drain__hint">{t('drain.hint')}</p>

      <ul className="drain__list" onPointerDown={stopCountdown}>
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

      <button className="drain__skip" type="button" onClick={onSkip}>
        {t('drain.skip')}
        {left > 0 && <span className="drain__count">{left}</span>}
      </button>
    </Sheet>
  );
}
