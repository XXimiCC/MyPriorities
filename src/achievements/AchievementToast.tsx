import { useEffect, useState } from 'react';

import { plural, t } from '../i18n';
import { useStore } from '../store/useStore';
import { GROUP_ICONS } from './icons';
import { BY_ID } from './registry';
import { titleOf } from './note';
import './AchievementToast.css';

const VISIBLE_MS = 4200;
/** Порог смахивания. Ниже — и плашку убирал бы случайный сдвиг пальца при нажатии «Посмотреть». */
const SWIPE_PX = 64;
/** Столько плашка уходит за край. Совпадает с transition в CSS, иначе она пропадёт рывком. */
const LEAVE_MS = 200;

/** Значок для пачки достижений: группа у них разная, общего значка группы нет. */
const STAR = ['M12 3.4l2.6 5.4 6 .9-4.3 4.2 1 6-5.3-2.8-5.3 2.8 1-6-4.3-4.2 6-.9z'];

/**
 * Плашка о новых достижениях.
 *
 * Показывает одно название, а при пачке — общее число. Пачка бывает не от
 * везения, а от первого запуска модуля: у человека с полугодом истории разом
 * сходятся тридцать условий, и тридцать всплывашек подряд — это не праздник,
 * а помеха.
 *
 * Смахивается вбок. Само по себе оно уходит через VISIBLE_MS, но четыре секунды
 * поверх списка — это долго, если плашка накрыла ровно ту строку, по которой
 * сейчас нажимают.
 */
export function AchievementToast({ onOpen }: { onOpen(): void }): JSX.Element | null {
  const { fresh, actions } = useStore();
  /** Сдвиг пальцем по горизонтали, px. */
  const [shift, setShift] = useState(0);
  /** Пока палец на плашке, анимация возврата выключена: она должна идти за ним. */
  const [held, setHeld] = useState(false);
  /** Сторона, в которую плашка уезжает: -1 влево, 1 вправо, 0 — остаётся. */
  const [leaving, setLeaving] = useState(0);

  // Следующая пачка приезжает на чистое место, а не туда, куда утащили прошлую.
  useEffect(() => {
    setShift(0);
    setHeld(false);
    setLeaving(0);
  }, [fresh]);

  useEffect(() => {
    if (fresh.length === 0) return undefined;
    const timer = window.setTimeout(() => actions.dismissFresh(), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [fresh, actions]);

  /*
   * Слушатели вешаются на окно, а не на саму плашку: смахивают быстро, палец
   * успевает уйти за её край, и pointerup до неё уже не доходит — жест повисал
   * бы незавершённым, а плашка оставалась бы утащенной вбок.
   */
  const startDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const from = event.clientX;
    let last = 0;
    setHeld(true);

    const move = (moved: PointerEvent): void => {
      last = moved.clientX - from;
      setShift(last);
    };

    const stop = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      setHeld(false);
      if (Math.abs(last) < SWIPE_PX) {
        setShift(0);
        return;
      }
      setLeaving(last > 0 ? 1 : -1);
      window.setTimeout(() => actions.dismissFresh(), LEAVE_MS);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  if (fresh.length === 0) return null;

  const single = fresh.length === 1 ? BY_ID.get(fresh[0]!) : undefined;
  const paths = single ? GROUP_ICONS[single.group] : STAR;

  const offset = leaving ? `calc(${leaving * 100}% + ${leaving * 28}px)` : `${shift}px`;
  // Утаскиваемая плашка гаснет: видно, что жест ведёт к исчезновению, а не к сдвигу.
  const fade = leaving ? 0 : 1 - Math.min(Math.abs(shift) / 300, 0.5);

  return (
    <div
      className={held ? 'atoast atoast--held' : 'atoast'}
      style={{ transform: `translateX(${offset})`, opacity: fade }}
    >
      <span className="atoast__glow" aria-hidden="true" />

      <div className="atoast__card" role="status" onPointerDown={startDrag}>
        <span className="atoast__medal" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {paths.map((d) => (
              <path key={d} d={d} />
            ))}
          </svg>
        </span>

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
    </div>
  );
}
