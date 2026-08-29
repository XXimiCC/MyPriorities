import { Suspense, lazy, useEffect, useState } from 'react';

import { AchievementToast } from './achievements/AchievementToast';
import { Watcher } from './achievements/Watcher';
import { BRAND_ASKED } from './brandkit/entry';
import { BatteryPromptProvider } from './components/BatteryPrompt';
import { DemoBar } from './components/DemoBar';
import { LazyBoundary } from './components/LazyBoundary';
import { NightSheet } from './components/NightSheet';
import { AchievementsScreen } from './screens/AchievementsScreen';
import { ChargeScreen } from './screens/ChargeScreen';
import { DemoScreen } from './screens/DemoScreen';
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

/*
 * Брендкит грузится отдельным куском: восемнадцать разделов справочника нужны
 * разработчику раз в неделю, а вес основного бандла платят все и всегда.
 */
const BrandKit = lazy(() => import('./brandkit/BrandKit').then((m) => ({ default: m.BrandKit })));

type Tab = 'home' | 'stats' | 'charge' | 'skills' | 'settings';

/**
 * Контур шестерёнки: шесть одинаковых зубцов, посчитанных по окружности
 * (внешний радиус 9.8, внутренний 7, зубец 32°). Тот же контур повторён у
 * группы достижений «Ритуалы» — как и значок «Навыки», который уже живёт в двух
 * местах: путь короче любого способа его расшарить между вкладками и группами.
 */
const GEAR =
  'M9.3 2.58L14.7 2.58L14.85 5.61L16.11 6.34L18.81 4.95L21.51 9.63L18.96 11.27' +
  'L18.96 12.73L21.51 14.37L18.81 19.05L16.11 17.66L14.85 18.39L14.7 21.42' +
  'L9.3 21.42L9.15 18.39L7.89 17.66L5.19 19.05L2.49 14.37L5.04 12.73L5.04 11.27' +
  'L2.49 9.63L5.19 4.95L7.89 6.34L9.15 5.61Z';

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
    /*
     * Шестерёнка построена по кругу, а не нарисована на глаз: прежний контур
     * набирался относительными сдвигами, зубцы получались разной длины и
     * ширины, и на двадцати пикселях значок читался как кривая звезда.
     * Шесть зубцов, а не восемь: на размере вкладки восемь сливаются в рябь.
     */
    icon: [GEAR, 'M12 15a3 3 0 100-6 3 3 0 000 6'],
  },
];

/** Вложенные экраны поверх вкладок. */
type Overlay = 'edit' | 'presets' | 'achievements' | 'demo' | 'brand' | null;

/*
 * Куда смотрит человек — для панели отладки и только для неё.
 *
 * Модульная переменная, а не контекст: панель живёт в отдельном корне React
 * намеренно, чтобы пережить падение этого дерева, и до контекста ей не
 * дотянуться. Роутера в приложении нет, второго тут тоже не появляется —
 * это одна строка присваивания при рендере.
 */
let route = 'home';

export function readCurrentRoute(): string {
  return route;
}

/*
 * Открытая вкладка переживает пересборку дерева.
 *
 * При смене языка приложение пересобирается целиком (см. main.tsx), а «English»
 * нажимают стоя в настройках — без этой строки человек оказывался бы на главной
 * и гадал, что он сделал. Модульная переменная, как и route выше: роутера нет,
 * а класть вкладку в Settings значило бы синхронизировать её между устройствами.
 */
let openTab: Tab = 'home';

const OVERLAY_ACTION: Record<Exclude<Overlay, null>, StringKey> = {
  edit: 'common.done',
  presets: 'common.back',
  achievements: 'common.back',
  demo: 'common.back',
  brand: 'common.back',
};

export function App(): JSX.Element {
  const { ready, settings } = useStore();
  const [tab, setTab] = useState<Tab>(openTab);
  const [overlay, setOverlay] = useState<Overlay>(BRAND_ASKED ? 'brand' : null);

  /* Единственный путь смены вкладки: модульная переменная обязана знать о ней
     столько же, сколько состояние, иначе пересборка вернёт человека назад. */
  const goTab = (next: Tab): void => {
    openTab = next;
    setTab(next);
  };

  // На вложенном экране системная «назад» возвращает к вкладкам, а не закрывает мини-апп.
  useEffect(() => {
    if (!overlay) return undefined;
    return backButton.show(() => setOverlay(null));
  }, [overlay]);

  const onboarding = !settings.onboarded && settings.priorities.length === 0;
  const modules = modulesOf(settings);
  route = overlay ?? (onboarding ? 'onboarding' : tab);
  const tabs = TABS.filter((item) => item.id !== 'skills' || modules.skills);

  /* Полный сброс возвращает к онбордингу — вложенный экран поверх него не нужен.
     Брендкит исключение: его открывают адресом, и на пустом кабинете он нужен
     ровно так же, как на полном. */
  useEffect(() => {
    if (onboarding) setOverlay((current) => (current === 'brand' ? current : null));
  }, [onboarding]);

  // Выключенный модуль не должен оставить пользователя на исчезнувшей вкладке.
  useEffect(() => {
    if (!modules.skills && tab === 'skills') goTab('home');
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

  /* Вложенный экран стоит выше онбординга: брендкит открывают адресом, и
     справочник по стилям нужен ровно так же на пустом кабинете, как на полном. */
  if (overlay) {
    return (
      <div className="app">
        <DemoBar />
        {overlay === 'edit' && <EditPrioritiesScreen />}
        {overlay === 'presets' && <PresetsScreen onApplied={() => setOverlay(null)} />}
        {overlay === 'achievements' && <AchievementsScreen />}
        {overlay === 'demo' && <DemoScreen />}
        {overlay === 'brand' && (
          /* Граница снаружи Suspense: она ловит именно отказ загрузки, а не
             ожидание. Без неё сорвавшийся чанк уносит всё дерево. */
          <LazyBoundary>
            <Suspense fallback={<span className="wp__spinner" aria-label={t('app.loading')} />}>
              <BrandKit />
            </Suspense>
          </LazyBoundary>
        )}
        <div className="app__footer">
          <button type="button" onClick={() => setOverlay(null)}>
            {t(OVERLAY_ACTION[overlay])}
          </button>
        </div>
        {modules.achievements && <Watcher />}
      </div>
    );
  }

  /* Плашка демо стоит и здесь: изнутри демо до онбординга доводит «сбросить
     кабинет», и оставить гостя там без выхода нельзя. */
  if (onboarding) {
    return (
      <div className="app">
        <DemoBar />
        <OnboardingScreen />
      </div>
    );
  }

  return (
    /* Провайдер вокруг вкладок, а не вокруг всего приложения: батарейка в шапке
       живёт только здесь, а шторка с вопросом про расход — одна на все вкладки. */
    <BatteryPromptProvider>
      <div className="app app--tabs">
        <DemoBar />
        {tab === 'home' && <HomeScreen onEdit={() => setOverlay('edit')} />}
        {tab === 'stats' && <StatsScreen onDemo={() => setOverlay('demo')} />}
        {tab === 'charge' && <ChargeScreen />}
        {tab === 'skills' && <SkillsScreen />}
        {tab === 'settings' && (
          <SettingsScreen
            onPresets={() => setOverlay('presets')}
            onAchievements={() => setOverlay('achievements')}
            onDemo={() => setOverlay('demo')}
            onBrand={() => setOverlay('brand')}
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
                goTab(item.id);
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

        {/* Утренний вопрос про ночь. Здесь, а не на экране «Заряд»: ночь не
            отмечена независимо от того, на какой вкладке открыли приложение. */}
        <NightSheet />

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
