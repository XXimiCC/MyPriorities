import { colorOf } from '../domain/palette';
import { DEMO_PROFILES, type DemoProfile } from '../demo/profiles';
import { enterDemo } from '../demo/mode';
import { t } from '../i18n';
import { useStore } from '../store/useStore';
import { haptics } from '../telegram/sdk';
import './DemoScreen.css';

/**
 * Витрина демо-профилей: «показать другу, не показывая своё».
 *
 * Подтверждения нет намеренно. Действие безопасное и обратимое: свои данные
 * остаются на месте, выход висит плашкой сверху. Лишний вопрос здесь означал бы,
 * что приложение считает показ приложения опасным.
 */
export function DemoScreen(): JSX.Element {
  const { actions } = useStore();

  const open = (profile: DemoProfile): void => {
    haptics.tap();
    void (async () => {
      // Вход перезагружает страницу. Клик, сделанный за полсекунды до него,
      // висит в отложенной записи и уехал бы вместе с ней.
      await actions.flushPending();
      enterDemo(profile.id);
    })();
  };

  return (
    <>
      <header className="header">
        <h1 className="header__title">{t('demo.title')}</h1>
      </header>

      <div className="app__body">
        <p className="edit__hint">{t('demo.intro')}</p>

        <ul className="demos">
          {DEMO_PROFILES.map((profile) => (
            <li key={profile.id}>
              <button
                className="dcard press"
                type="button"
                style={{ '--accent': colorOf(profile.accentId).hex } as React.CSSProperties}
                onClick={() => open(profile)}
              >
                <svg
                  className="picon"
                  width="30"
                  height="30"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {profile.icon.map((d) => (
                    <path key={d} d={d} />
                  ))}
                </svg>
                <span className="dcard__name">{profile.name}</span>
                <span className="dcard__tagline">{profile.tagline}</span>
                <span className="dcard__shows">{profile.shows}</span>
              </button>
            </li>
          ))}
        </ul>

        <p className="sset__note">{t('demo.note')}</p>
      </div>
    </>
  );
}
