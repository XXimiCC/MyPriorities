import { useEffect, useMemo, useState } from 'react';

import { formatDayShort, formatMinutes } from '../domain/date';
import { findPreset } from '../domain/presets';
import { computeStats, earliestDay, periodDays } from '../domain/stats';
import { BLOCK_OPTIONS, PERIODS, blockMinutesOf } from '../domain/types';
import { MOCK_MODE } from '../store/mock';
import { RETENTION_MONTHS } from '../store/persistence';
import { useStore } from '../store/useStore';
import { store } from '../telegram/cloudStorage';
import { alertDialog, clientInfo, confirmDialog, haptics, homeScreen, isTelegram } from '../telegram/sdk';
import { saveFile } from '../wallpaper/save';
import { plural } from './HomeScreen';
import './SettingsScreen.css';

const ALL_TIME = PERIODS.find((p) => p.id === 'all')!;

interface Props {
  onPresets(): void;
}

export function SettingsScreen({ onPresets }: Props): JSX.Element {
  const { settings, journal, actions } = useStore();
  const [busy, setBusy] = useState(false);
  const [homeStatus, setHomeStatus] = useState<string>('unsupported');

  const blockMinutes = blockMinutesOf(settings);
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

  const run = (task: () => Promise<void>): void => {
    if (busy) return;
    setBusy(true);
    void task().finally(() => setBusy(false));
  };

  const resetHistory = (): void =>
    run(async () => {
      const ok = await confirmDialog(
        `Стереть всю историю? Пропадут ${totals.totalBlocks} ${plural(totals.totalBlocks, 'блок', 'блока', 'блоков')} и весь лог заряда. Приоритеты останутся. Отменить это будет нельзя.`,
      );
      if (!ok) return;
      await actions.resetHistory();
      haptics.success();
      await alertDialog('История стёрта. Приоритеты на месте — можно начинать заново.');
    });

  const resetEverything = (): void =>
    run(async () => {
      const ok = await confirmDialog(
        'Сбросить кабинет полностью? Пропадут история, список приоритетов и все настройки — приложение вернётся к выбору набора. Отменить это будет нельзя.',
      );
      if (!ok) return;
      await actions.resetEverything();
      haptics.warning();
    });

  const exportData = (): void =>
    run(async () => {
      const json = actions.exportData();
      const blob = new Blob([json], { type: 'application/json' });
      const outcome = await saveFile(blob, 'my-priorities-backup.json', 'application/json');
      if (outcome === 'manual') {
        await alertDialog('Не удалось сохранить файл. Откройте приложение в браузере и повторите.');
      }
    });

  const importData = (file: File): void =>
    run(async () => {
      try {
        const text = await file.text();
        const ok = await confirmDialog(
          'Восстановить данные из копии? Текущие приоритеты и вся история будут заменены содержимым файла.',
        );
        if (!ok) return;
        const restored = await actions.importData(text);
        haptics.success();
        await alertDialog(
          `Готово: ${restored.settings.priorities.length} ${plural(restored.settings.priorities.length, 'приоритет', 'приоритета', 'приоритетов')}, ${Object.keys(restored.journal.clicks).length} ${plural(Object.keys(restored.journal.clicks).length, 'день', 'дня', 'дней')} истории.`,
        );
      } catch (error) {
        haptics.warning();
        await alertDialog(error instanceof Error ? error.message : 'Не удалось прочитать копию.');
      }
    });

  return (
    <>
      <header className="header">
        <h1 className="header__title">Настройки</h1>
      </header>

      <div className="app__body">
        <div className="divider-label">
          <span>Приоритеты</span>
        </div>

        <button className="sset__row press" type="button" onClick={onPresets}>
          <span className="sset__row-text">
            <b>Готовые наборы</b>
            <small>
              {current
                ? `Сейчас: ${current.name}`
                : 'Сборники приоритетов под тип жизни — можно заменить свой список целиком'}
            </small>
          </span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="divider-label">
          <span>Цена одного клика</span>
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
              }}
            >
              {option} <small>мин</small>
            </button>
          ))}
        </div>
        <p className="sset__note">
          Хранятся клики, а не часы, поэтому смена цены пересчитывает и прошлые записи. Сейчас{' '}
          {totals.totalBlocks} {plural(totals.totalBlocks, 'блок', 'блока', 'блоков')} — это{' '}
          {formatMinutes(totals.totalMinutes)}.
        </p>

        <div className="divider-label">
          <span>Данные</span>
        </div>

        <ul className="sset__facts">
          <li>
            <span>Где хранятся</span>
            <b className={synced ? undefined : 'sset__warn'}>
              {synced ? 'Аккаунт Telegram' : 'Только это устройство'}
            </b>
          </li>
          <li>
            <span>История с</span>
            <b>{since ? formatDayShort(since) : '—'}</b>
          </li>
          <li>
            <span>Глубина хранения</span>
            <b>
              {RETENTION_MONTHS} {plural(RETENTION_MONTHS, 'месяц', 'месяца', 'месяцев')}
            </b>
          </li>
          <li>
            <span>Клиент</span>
            <b>
              {clientInfo.platform} {clientInfo.version}
            </b>
          </li>
        </ul>

        {/* Молчаливый откат на локальное хранилище выглядит как пропажа данных:
            на телефоне всё есть, на компьютере пусто. Поэтому он назван вслух. */}
        {!synced && (
          <p className="sset__note sset__warn">
            {clientInfo.isTelegram
              ? 'Этот клиент Telegram не отдал общее хранилище, поэтому данные лежат только на этом устройстве и не видны на других. Перенести их можно через «Скачать копию данных» и «Восстановить из копии».'
              : 'Приложение открыто вне Telegram, поэтому данные лежат в этом браузере и между устройствами не синхронизируются.'}
          </p>
        )}

        <button className="edit__add press" type="button" disabled={busy} onClick={exportData}>
          Скачать копию данных
        </button>

        <label className="edit__add press sset__gap sset__file">
          Восстановить из копии
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
              window.setTimeout(() => void homeScreen.status().then(setHomeStatus), 3000);
            }}
          >
            Добавить ярлык на главный экран
          </button>
        )}
        {homeStatus === 'added' && <p className="sset__note">Ярлык уже на главном экране.</p>}

        <div className="divider-label">
          <span>Сброс</span>
        </div>

        <button className="sset__danger press" type="button" disabled={busy} onClick={resetHistory}>
          <b>Стереть историю</b>
          <small>Клики и заряд обнуляются, приоритеты остаются</small>
        </button>

        <button className="sset__danger press" type="button" disabled={busy} onClick={resetEverything}>
          <b>Сбросить кабинет</b>
          <small>История, приоритеты и настройки — начать с чистого листа</small>
        </button>

        <p className="sset__note sset__gap">
          {isTelegram
            ? 'Сброс удаляет данные и из облака Telegram, то есть на всех ваших устройствах сразу.'
            : 'Сброс удаляет данные только в этом браузере.'}
          {MOCK_MODE && ' Сейчас включён демо-режим: данные ненастоящие и никуда не пишутся.'}
        </p>
      </div>
    </>
  );
}
