import { useEffect, useState } from 'react';

import { ChargeScreen } from './screens/ChargeScreen';
import { EditPrioritiesScreen } from './screens/EditPrioritiesScreen';
import { HomeScreen } from './screens/HomeScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { PresetsScreen } from './screens/PresetsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { StatsScreen } from './screens/StatsScreen';
import { t, type StringKey } from './i18n';
import { useStore } from './store/useStore';
import { backButton, haptics } from './telegram/sdk';

type Tab = 'home' | 'stats' | 'charge' | 'settings';

const TABS: Array<{ id: Tab; labelKey: StringKey; icon: string[] }> = [
  { id: 'home', labelKey: 'tab.home', icon: ['M4 10.5L12 4l8 6.5V20a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z'] },
  { id: 'stats', labelKey: 'tab.stats', icon: ['M4 20V9M10 20V4M16 20v-7M22 20H2'] },
  { id: 'charge', labelKey: 'tab.charge', icon: ['M3 8h13v8H3zM16 10.5h3v3h-3', 'M7 10.5h4v3H7'] },
  {
    id: 'settings',
    labelKey: 'tab.settings',
    icon: [
      'M12 15a3 3 0 100-6 3 3 0 000 6',
      'M12 2.8l1.5 2.3 2.7-.5.6 2.7 2.4 1.3-1.4 2.4 1.4 2.4-2.4 1.3-.6 2.7-2.7-.5L12 21.2l-1.5-2.3-2.7.5-.6-2.7-2.4-1.3L6.2 13l-1.4-2.4 2.4-1.3.6-2.7 2.7.5z',
    ],
  },
];

/** Вложенные экраны поверх вкладок. */
type Overlay = 'edit' | 'presets' | null;

const OVERLAY_ACTION: Record<Exclude<Overlay, null>, StringKey> = {
  edit: 'common.done',
  presets: 'common.back',
};

export function App(): JSX.Element {
  const { ready, settings } = useStore();
  const [tab, setTab] = useState<Tab>('home');
  const [overlay, setOverlay] = useState<Overlay>(null);

  // На вложенном экране системная «назад» возвращает к вкладкам, а не закрывает мини-апп.
  useEffect(() => {
    if (!overlay) return undefined;
    return backButton.show(() => setOverlay(null));
  }, [overlay]);

  const onboarding = !settings.onboarded && settings.priorities.length === 0;

  // Полный сброс возвращает к онбордингу — вложенный экран поверх него не нужен.
  useEffect(() => {
    if (onboarding) setOverlay(null);
  }, [onboarding]);

  if (!ready) {
    return (
      <div className="app app--loading">
        <span className="wp__spinner" aria-label={t('app.loading')} />
      </div>
    );
  }

  if (onboarding) {
    return (
      <div className="app">
        <OnboardingScreen />
      </div>
    );
  }

  if (overlay) {
    return (
      <div className="app">
        {overlay === 'edit' && <EditPrioritiesScreen />}
        {overlay === 'presets' && <PresetsScreen onApplied={() => setOverlay(null)} />}
        <div className="app__footer">
          <button type="button" onClick={() => setOverlay(null)}>
            {t(OVERLAY_ACTION[overlay])}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app app--tabs">
      {tab === 'home' && <HomeScreen onEdit={() => setOverlay('edit')} />}
      {tab === 'stats' && <StatsScreen />}
      {tab === 'charge' && <ChargeScreen />}
      {tab === 'settings' && <SettingsScreen onPresets={() => setOverlay('presets')} />}

      <nav className="tabbar" role="tablist" aria-label={t('app.title')}>
        {TABS.map((item) => (
          <button
            key={item.id}
            className="tabbar__item"
            role="tab"
            type="button"
            aria-selected={tab === item.id}
            onClick={() => {
              if (tab === item.id) return;
              haptics.select();
              setTab(item.id);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {item.icon.map((d) => (
                <path key={d} d={d} />
              ))}
            </svg>
            {t(item.labelKey)}
          </button>
        ))}
      </nav>
    </div>
  );
}
