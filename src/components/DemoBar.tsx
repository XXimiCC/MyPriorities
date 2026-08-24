import { colorOf } from '../domain/palette';
import { DEMO_ID, GUEST_MODE, leaveDemo } from '../demo/mode';
import { findProfile } from '../demo/profiles';
import { t } from '../i18n';
import { confirmDialog, haptics } from '../telegram/sdk';
import './DemoBar.css';

/**
 * Плашка «сейчас демо» с выходом.
 *
 * Висит только в гостевом режиме — том, в который входят из настроек или по
 * ссылке. При съёмке документации (`?mock=`) её быть не должно: кадр настроек с
 * чужой полосой сверху описывал бы не то приложение, которое видит человек.
 *
 * Выход спрашивает подтверждение, хотя действие и безобидное. Один тап без
 * вопроса означал бы, что друг, промахнувшись мимо вкладки, возвращает владельца
 * в его собственные приоритеты — ровно то, от чего вся затея.
 */
export function DemoBar(): JSX.Element | null {
  const profile = findProfile(DEMO_ID);
  if (!GUEST_MODE || !profile) return null;

  const exit = (): void => {
    void (async () => {
      if (!(await confirmDialog(t('demo.exitConfirm')))) return;
      haptics.tap();
      leaveDemo();
    })();
  };

  return (
    <div
      className="demobar"
      style={{ '--accent': colorOf(profile.accentId).hex } as React.CSSProperties}
    >
      <span className="demobar__dot" aria-hidden="true" />
      <span className="demobar__text">
        {t('demo.bar')} · <b>{t(profile.nameKey)}</b>
      </span>
      <button className="demobar__exit press" type="button" onClick={exit}>
        {t('demo.exit')}
      </button>
    </div>
  );
}
