import { useEffect, useMemo, useState } from 'react';

import { awardProgress } from '../achievements/evaluate';
import { HeaderBattery } from '../components/HeaderBattery';
import { Toggle } from '../components/Toggle';
import { formatDayShort, formatMinutes } from '../domain/date';
import { findPreset } from '../domain/presets';
import { computeStats, earliestDay, periodDays } from '../domain/stats';
import { BLOCK_OPTIONS, PERIODS, blockMinutesOf, modulesOf } from '../domain/types';
import { plural, t, type StringKey } from '../i18n';
import { MOCK_MODE } from '../store/mock';
import { SnapshotError } from '../domain/snapshot';
import { RETENTION_MONTHS } from '../store/legacy/persistence';
import { useStore } from '../store/useStore';
import { store } from '../telegram/cloudStorage';
import { alertDialog, clientInfo, confirmDialog, haptics, homeScreen, isTelegram } from '../telegram/sdk';
import { subscribeSync, syncState, type SyncState } from '../sync/auth';
import { saveFile } from '../wallpaper/save';
import './SettingsScreen.css';

/**
 * Подпись состояния сессии. Таблица, а не цепочка условий: тип
 * `Record<SyncState['kind'], StringKey>` делает её исчерпывающей, и новое
 * состояние, забытое здесь, не соберётся.
 */
const ACCOUNT_LABEL: Record<SyncState['kind'], StringKey> = {
  off: 'settings.accountNone',
  working: 'settings.accountWorking',
  'signed-in': 'settings.accountOn',
  'no-way-in': 'settings.accountNone',
  offline: 'settings.accountOffline',
  error: 'settings.accountError',
};

const ALL_TIME = PERIODS.find((p) => p.id === 'all')!;

interface Props {
  onPresets(): void;
  onAchievements(): void;
}

export function SettingsScreen({ onPresets, onAchievements }: Props): JSX.Element {
  const { settings, journal, awards, actions } = useStore();
  const [busy, setBusy] = useState(false);
  const [homeStatus, setHomeStatus] = useState<string>('unsupported');
  const [sync, setSync] = useState<SyncState>(syncState);

  const blockMinutes = blockMinutesOf(settings);
  const modules = modulesOf(settings);
  const achievements = awardProgress(awards, modules.skills);
  const totals = useMemo(
    () => computeStats(settings, journal, periodDays(ALL_TIME, journal)),
    [settings, journal],
  );
  const since = earliestDay(journal);
  const current = findPreset(settings.presetId);
  const synced = store.kind === 'cloud' && !store.isDegraded();

  useEffect(() => {
    if (!homeScreen.supported()) return;
    void homeScreen.status().then(setHomeStatus);
  }, []);

  // Вход идёт фоном и может закончиться уже после того, как экран открыли.
  useEffect(() => subscribeSync(setSync), []);

  const run = (task: () => Promise<void>): void => {
    if (busy) return;
    setBusy(true);
    void task().finally(() => setBusy(false));
  };

  const resetHistory = (): void =>
    run(async () => {
      const ok = await confirmDialog(
        t('settings.resetHistoryConfirm', {
          count: totals.totalBlocks,
          unit: plural('block', totals.totalBlocks),
        }),
      );
      if (!ok) return;
      await actions.resetHistory();
      haptics.success();
      await alertDialog(t('settings.resetHistoryDone'));
    });

  const resetEverything = (): void =>
    run(async () => {
      const ok = await confirmDialog(t('settings.resetAllConfirm'));
      if (!ok) return;
      await actions.resetEverything();
      haptics.warning();
    });

  const exportData = (): void =>
    run(async () => {
      const json = actions.exportData();
      const blob = new Blob([json], { type: 'application/json' });
      const outcome = await saveFile(blob, 'my-priorities-backup.json', 'application/json');
      actions.award('r2');
      if (outcome !== 'manual') return;

      // Долгое нажатие спасает картинку, но не JSON. Буфер обмена — единственный
      // путь забрать копию из клиента, который не умеет сохранять файлы.
      try {
        await navigator.clipboard.writeText(json);
        await alertDialog(t('settings.exportCopied'));
      } catch {
        await alertDialog(t('settings.exportFailed'));
      }
    });

  const importData = (file: File): void =>
    run(async () => {
      try {
        const text = await file.text();
        const ok = await confirmDialog(t('settings.importConfirm'));
        if (!ok) return;
        const restored = await actions.importData(text);
        const days = Object.keys(restored.journal.clicks).length;
        actions.award('r3');
        haptics.success();
        await alertDialog(
          t('settings.importDone', {
            priorities: restored.settings.priorities.length,
            pUnit: plural('priority', restored.settings.priorities.length),
            days,
            dUnit: plural('day', days),
          }),
        );
      } catch (error) {
        haptics.warning();
        await alertDialog(
          error instanceof SnapshotError ? t(error.key) : t('settings.importFailed'),
        );
      }
    });

  return (
    <>
      <header className="header">
        <h1 className="header__title">{t('settings.title')}</h1>
        <div className="header__actions">
          <HeaderBattery />
        </div>
      </header>

      <div className="app__body">
        <div className="divider-label">
          <span>{t('settings.prioritiesTitle')}</span>
        </div>

        <button className="sset__row press" type="button" onClick={onPresets}>
          <span className="sset__row-text">
            <b>{t('settings.presetsRow')}</b>
            <small>
              {current ? t('settings.presetsCurrent', { name: current.name }) : t('settings.presetsNone')}
            </small>
          </span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="divider-label">
          <span>{t('settings.modulesTitle')}</span>
        </div>

        <Toggle
          label={t('settings.moduleSkills')}
          note={t('settings.moduleSkillsNote')}
          checked={modules.skills}
          onChange={(next) => void actions.setModule('skills', next)}
        />
        <Toggle
          label={t('settings.moduleAchievements')}
          note={t('settings.moduleAchievementsNote')}
          checked={modules.achievements}
          onChange={(next) => void actions.setModule('achievements', next)}
        />
        <Toggle
          label={t('settings.moduleInsights')}
          note={t('settings.moduleInsightsNote')}
          checked={modules.insights}
          onChange={(next) => void actions.setModule('insights', next)}
        />

        {modules.achievements && (
          <button className="sset__row press sset__gap" type="button" onClick={onAchievements}>
            {/* Значок нужен, чтобы строка не терялась среди тумблеров: достижения
                живут только здесь, и найти их должно быть легко. */}
            <span className="sset__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 4h8v5a4 4 0 01-8 0z" />
                <path d="M8 5H5v2a3 3 0 003 3M16 5h3v2a3 3 0 01-3 3" />
                <path d="M12 13v4M9 20h6M10 17h4l1 3H9z" />
              </svg>
            </span>
            <span className="sset__row-text">
              <b>{t('settings.achievementsRow')}</b>
              <small>{t('settings.achievementsCount', achievements)}</small>
            </span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
              <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        <p className="sset__note">{t('settings.moduleOff')}</p>

        <div className="divider-label">
          <span>{t('settings.blockTitle')}</span>
        </div>

        <div className="sset__blocks">
          {BLOCK_OPTIONS.map((option) => (
            <button
              key={option}
              className={`sset__block${option === blockMinutes ? ' sset__block--on' : ''}`}
              type="button"
              onClick={() => {
                if (option === blockMinutes) return;
                haptics.select();
                actions.setBlockMinutes(option);
                actions.award('r9');
              }}
            >
              {option} <small>{t('settings.blockUnit')}</small>
            </button>
          ))}
        </div>
        <p className="sset__note">
          {t('settings.blockNote', {
            count: totals.totalBlocks,
            unit: plural('block', totals.totalBlocks),
            time: formatMinutes(totals.totalMinutes),
          })}
        </p>

        <div className="divider-label">
          <span>{t('settings.dataTitle')}</span>
        </div>

        <ul className="sset__facts">
          <li>
            <span>{t('settings.where')}</span>
            <b className={synced ? undefined : 'sset__warn'}>
              {synced ? t('settings.whereCloud') : t('settings.whereLocal')}
            </b>
          </li>
          <li>
            <span>{t('settings.since')}</span>
            <b>{since ? formatDayShort(since) : t('common.nothing')}</b>
          </li>
          <li>
            <span>{t('settings.retention')}</span>
            <b>
              {RETENTION_MONTHS} {plural('month', RETENTION_MONTHS)}
            </b>
          </li>
          <li>
            <span>{t('settings.client')}</span>
            <b>
              {clientInfo.platform} {clientInfo.version}
            </b>
          </li>
          {/* Строка появляется, только когда сервер вообще настроен сборкой:
              без него говорить про аккаунт нечего, и пустой пункт только
              добавил бы вопросов. */}
          {sync.kind !== 'off' && (
            <li>
              <span>{t('settings.account')}</span>
              <b className={sync.kind === 'signed-in' ? undefined : 'sset__warn'}>
                {t(ACCOUNT_LABEL[sync.kind])}
              </b>
            </li>
          )}
        </ul>

        {/* Молчаливый откат на локальное хранилище выглядит как пропажа данных:
            на телефоне всё есть, на компьютере пусто. Поэтому он назван вслух. */}
        {!synced && (
          <p className="sset__note sset__warn">
            {clientInfo.isTelegram ? t('settings.noSyncTelegram') : t('settings.noSyncBrowser')}
          </p>
        )}

        <button className="edit__add press" type="button" disabled={busy} onClick={exportData}>
          {t('settings.export')}
        </button>

        <label className="edit__add press sset__gap sset__file">
          {t('settings.import')}
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Сбрасываем значение, иначе повторный выбор того же файла не даёт события.
              event.target.value = '';
              if (file) importData(file);
            }}
          />
        </label>

        {homeScreen.supported() && homeStatus !== 'added' && (
          <button
            className="edit__add press sset__gap"
            type="button"
            onClick={() => {
              haptics.tap();
              homeScreen.add();
              window.setTimeout(() => {
                void homeScreen.status().then((status) => {
                  setHomeStatus(status);
                  if (status === 'added') actions.award('r4');
                });
              }, 3000);
            }}
          >
            {t('settings.homeScreen')}
          </button>
        )}
        {homeStatus === 'added' && <p className="sset__note">{t('settings.homeScreenAdded')}</p>}

        <div className="divider-label">
          <span>{t('settings.resetTitle')}</span>
        </div>

        <button className="sset__danger press" type="button" disabled={busy} onClick={resetHistory}>
          <b>{t('settings.resetHistory')}</b>
          <small>{t('settings.resetHistoryNote')}</small>
        </button>

        <button className="sset__danger press" type="button" disabled={busy} onClick={resetEverything}>
          <b>{t('settings.resetAll')}</b>
          <small>{t('settings.resetAllNote')}</small>
        </button>

        <p className="sset__note sset__gap">
          {isTelegram ? t('settings.resetScopeCloud') : t('settings.resetScopeLocal')}
          {MOCK_MODE && t('settings.mockNote')}
        </p>
      </div>
    </>
  );
}
