import { useEffect, useState } from 'react';

import { AchievementToast } from './achievements/AchievementToast';
import { Watcher } from './achievements/Watcher';
import { BatteryPromptProvider } from './components/BatteryPrompt';
import { AchievementsScreen } from './screens/AchievementsScreen';
import { ChargeScreen } from './screens/ChargeScreen';
import { EditPrioritiesScreen } from './screens/EditPrioritiesScreen';
import { HomeScreen } from './screens/HomeScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { PresetsScreen } from './screens/PresetsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SkillsScreen } from './screens/SkillsScreen';
import { StatsScreen } from './screens/StatsScreen';
import { modulesOf } from './domain/types';
import { t, type StringKey } from './i18n';
import { useStore } from './store/useStore';
import { backButton, haptics } from './telegram/sdk';

type Tab = 'home' | 'stats' | 'charge' | 'skills' | 'settings';

/** Порядок вкладок — порядок внимания: сначала то, что отмечают каждый день. */
const TABS: Array<{ id: Tab; labelKey: StringKey; icon: string[] }> = [
  { id: 'home', labelKey: 'tab.home', icon: ['M4 6h16M4 12h16M4 18h9'] },
  {
    id: 'charge',
    labelKey: 'tab.charge',
    /*
     * Корпус нарисован двумя скобками, а не рамкой: молния проходит сквозь него
     * и потому влезает во всю высоту сетки. При обводке 1.6 замкнутый контур
     * молнии внутри целого корпуса слипался в пятно на двадцати пикселях —
     * именно столько остаётся иконке при пяти вкладках.
     */
    icon: [
      'M14.6 7.2h1.9a2.2 2.2 0 0 1 2.2 2.2v5.2a2.2 2.2 0 0 1-2.2 2.2h-2.6',
      'M7.4 7.2H5a2.2 2.2 0 0 0-2.2 2.2v5.2a2.2 2.2 0 0 0 2.2 2.2h1.6',
      'M20.4 11.1v2',
      'M11.6 6.2 L8.4 12 H12.4 L9.2 17.8',
    ],
  },
  {
    id: 'skills',
    labelKey: 'tab.skills',
    icon: ['M12 4l9 4.5-9 4.5-9-4.5z', 'M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5'],
  },
  { id: 'stats', labelKey: 'tab.stats', icon: ['M4 20V9M10 20V4M16 20v-7M22 20H2'] },
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
type Overlay = 'edit' | 'presets' | 'achievements' | null;

const OVERLAY_ACTION: Record<Exclude<Overlay, null>, StringKey> = {
  edit: 'common.done',
  presets: 'common.back',
  achievements: 'common.back',
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
  const modules = modulesOf(settings);
  const tabs = TABS.filter((item) => item.id !== 'skills' || modules.skills);

  // Полный сброс возвращает к онбордингу — вложенный экран поверх него не нужен.
  useEffect(() => {
    if (onboarding) setOverlay(null);
  }, [onboarding]);

  // Выключенный модуль не должен оставить пользователя на исчезнувшей вкладке.
  useEffect(() => {
    if (!modules.skills && tab === 'skills') setTab('home');
  }, [modules.skills, tab]);

  useEffect(() => {
    if (!modules.achievements && overlay === 'achievements') setOverlay(null);
  }, [modules.achievements, overlay]);

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
        {overlay === 'achievements' && <AchievementsScreen />}
        <div className="app__footer">
          <button type="button" onClick={() => setOverlay(null)}>
            {t(OVERLAY_ACTION[overlay])}
          </button>
        </div>
        {modules.achievements && <Watcher />}
      </div>
    );
  }

  return (
    /* Провайдер вокруг вкладок, а не вокруг всего приложения: батарейка в шапке
       живёт только здесь, а шторка с вопросом про расход — одна на все вкладки. */
    <BatteryPromptProvider>
      <div className="app app--tabs">
        {tab === 'home' && <HomeScreen onEdit={() => setOverlay('edit')} />}
        {tab === 'stats' && <StatsScreen />}
        {tab === 'charge' && <ChargeScreen />}
        {tab === 'skills' && <SkillsScreen />}
        {tab === 'settings' && (
          <SettingsScreen
            onPresets={() => setOverlay('presets')}
            onAchievements={() => setOverlay('achievements')}
          />
        )}

        <nav
          className={`tabbar${tabs.length >= 5 ? ' tabbar--five' : ''}`}
          role="tablist"
          aria-label={t('app.title')}
        >
          {tabs.map((item) => (
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
              <span className="tabbar__label">{t(item.labelKey)}</span>
            </button>
          ))}
        </nav>

        {modules.achievements && (
          <>
            <Watcher />
            <AchievementToast onOpen={() => setOverlay('achievements')} />
          </>
        )}
      </div>
    </BatteryPromptProvider>
  );
}
