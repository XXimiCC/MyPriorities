import { useEffect } from 'react';

import { plural, t } from '../i18n';
import { useStore } from '../store/useStore';
import { BY_ID } from './registry';
import { titleOf } from './note';
import './AchievementToast.css';

const VISIBLE_MS = 4200;

/**
 * Плашка о новых достижениях.
 *
 * Показывает одно название, а при пачке — общее число. Пачка бывает не от
 * везения, а от первого запуска модуля: у человека с полугодом истории разом
 * сходятся тридцать условий, и тридцать всплывашек подряд — это не праздник,
 * а помеха.
 */
export function AchievementToast({ onOpen }: { onOpen(): void }): JSX.Element | null {
  const { fresh, actions } = useStore();

  useEffect(() => {
    if (fresh.length === 0) return undefined;
    const timer = window.setTimeout(() => actions.dismissFresh(), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [fresh, actions]);

  if (fresh.length === 0) return null;

  const single = fresh.length === 1 ? BY_ID.get(fresh[0]!) : undefined;

  return (
    <div className="atoast" role="status">
      <span className="atoast__text">
        <b>
          {single
            ? t('ach.new')
            : t('ach.newMany', {
                count: fresh.length,
                unit: plural('achievement', fresh.length),
              })}
        </b>
        {single && <small>{titleOf(single)}</small>}
      </span>
      <button
        className="atoast__open"
        type="button"
        onClick={() => {
          actions.dismissFresh();
          onOpen();
        }}
      >
        {t('ach.open')}
      </button>
    </div>
  );
}
