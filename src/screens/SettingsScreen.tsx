import { useEffect, useMemo, useState } from 'react';

import { awardProgress } from '../achievements/evaluate';
import { BRAND_ROW } from '../brandkit/entry';
import { HeaderBattery } from '../components/HeaderBattery';
import { Toggle } from '../components/Toggle';
import { SECRET_HOLD_MS, useLongPress } from '../components/useLongPress';
import { revealDevkit } from '../devkitHost';
import { formatDayShort, formatMinutes } from '../domain/date';
import { findPreset } from '../domain/presets';
import { computeStats, earliestDay, periodDays } from '../domain/stats';
import { PERIODS } from '../domain/periods';
import { BLOCK_OPTIONS, blockMinutesOf, modulesOf } from '../domain/types';
import { chooseLanguage, LANGUAGES, plural, t, type StringKey } from '../i18n';
import { useLocale } from '../i18n/useLocale';
import { DEMO_MODE, GUEST_MODE } from '../demo/mode';
import { SnapshotError } from '../domain/snapshot';
import { useStore } from '../store/useStore';
import { store } from '../telegram/cloudStorage';
import { alertDialog, clientInfo, confirmDialog, haptics, homeScreen, isTelegram } from '../telegram/sdk';
import { buildLabel } from '../build';
import { somethingToRestore } from '../sync/adopt';
import { signIn, signOut, subscribeSync, syncState, type SyncState } from '../sync/auth';
import { transport } from '../sync/transport';
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
  'can-log-in': 'settings.accountCanLogIn',
  offline: 'settings.accountOffline',
  error: 'settings.accountError',
};

const ALL_TIME = PERIODS.find((p) => p.id === 'all')!;

interface Props {
  onPresets(): void;
  onAchievements(): void;
  onDemo(): void;
  onBrand(): void;
}

export function SettingsScreen({ onPresets, onAchievements, onDemo, onBrand }: Props): JSX.Element {
  const { settings, journal, skills, skillClicks, awards, actions } = useStore();
  const [busy, setBusy] = useState(false);
  const [homeStatus, setHomeStatus] = useState<string>('unsupported');
  const [sync, setSync] = useState<SyncState>(syncState);
  const [server, setServer] = useState<string | undefined>(undefined);
  const [hasBefore, setHasBefore] = useState(false);
  /* Хук, а не currentLocale(): экран сейчас пересобирается целиком, но это
     решение main.tsx, а не его — подписка остаётся верной и без ключа. */
  const locale = useLocale();
  const devkitHold = useLongPress(revealDevkit, SECRET_HOLD_MS);

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

  /*
   * Пересчитывается на каждое изменение состояния, а не один раз при открытии:
   * иначе кнопка возврата оставалась бы на экране сразу после того, как им
   * воспользовались, — то есть обещала бы уже сделанное.
   */
  useEffect(() => {
    void somethingToRestore({ settings, journal, skills, skillClicks, awards }).then(setHasBefore);
  }, [settings, journal, skills, skillClicks, awards]);

  // Версию сервера спрашиваем при открытии экрана: она меняется реже, чем его
  // открывают, а держать её в памяти всё равно негде.
  useEffect(() => {
    if (!transport.configured) return;
    let cancelled = false;
    void transport.version().then((value) => {
      if (!cancelled) setServer(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const restoreBefore = (): void =>
    run(async () => {
      const ok = await confirmDialog(t('settings.restoreBeforeConfirm'));
      if (!ok) return;
      try {
        const filled = await actions.restoreBeforeSync();
        if (filled === undefined) {
          await alertDialog(t('settings.restoreBeforeUnavailable'));
          return;
        }
        haptics.success();
        await alertDialog(t('settings.restoreBeforeDone'));
      } catch (error) {
        haptics.warning();
        await alertDialog(
          error instanceof SnapshotError ? t(error.key) : t('settings.importFailed'),
        );
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
        {/*
          Язык — первым разделом, и это не про важность.

          Тот, кто открыл приложение не на своём языке, ищет ровно этот
          переключатель и не может прочитать ни одну подпись, которая к нему
          ведёт. Значит, он обязан лежать там, куда попадаешь, а кнопки —
          называть себя сами. Заодно снимается вопрос про скролл: смена языка
          пересобирает дерево (см. main.tsx) и отматывает список наверх, а
          наверху это незаметно.

          Раздела нет, пока язык один: выбор из одного варианта объяснять
          дороже, чем не показывать.
        */}
        {LANGUAGES.length > 1 && (
          <>
            <div className="divider-label">
              <span>{t('settings.languageTitle')}</span>
            </div>

            <div className="sset__lang">
              {LANGUAGES.map((language) => (
                <button
                  key={language.code}
                  className={`sset__block${language.code === locale ? ' sset__block--on' : ''}`}
                  type="button"
                  lang={language.code}
                  onClick={() => {
                    if (language.code === locale) return;
                    haptics.select();
                    chooseLanguage(language.code);
                  }}
                >
                  {language.name}
                </button>
              ))}
            </div>
            <p className="note">{t('settings.languageNote')}</p>
          </>
        )}

        <div className="divider-label">
          <span>{t('settings.prioritiesTitle')}</span>
        </div>

        <button className="navrow press" type="button" onClick={onPresets}>
          <span className="navrow__text">
            <b>{t('settings.presetsRow')}</b>
            <small>
              {current ? t('settings.presetsCurrent', { name: t(current.nameKey) }) : t('settings.presetsNone')}
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
          /*
           * Пять секунд удержания на этой строке показывают значок панели
           * отладки. Место выбрано за то, что здесь нечему помешать: строка
           * ведёт на вложенный экран, своего долгого нажатия у неё нет, а
           * пятисекундное удержание не выходит случайно ни у кого.
           *
           * Короткий тап работает как прежде — открывает достижения; после
           * срабатывания удержания он подавляется, иначе поверх появившегося
           * значка сразу открывался бы экран.
           */
          <button
            className="navrow press sset__gap"
            type="button"
            {...devkitHold.handlers}
            onClick={() => {
              if (devkitHold.wasLongPress()) return;
              onAchievements();
            }}
          >
            {/* Значок нужен, чтобы строка не терялась среди тумблеров: достижения
                живут только здесь, и найти их должно быть легко. */}
            <span className="navrow__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 4h8v5a4 4 0 01-8 0z" />
                <path d="M8 5H5v2a3 3 0 003 3M16 5h3v2a3 3 0 01-3 3" />
                <path d="M12 13v4M9 20h6M10 17h4l1 3H9z" />
              </svg>
            </span>
            <span className="navrow__text">
              <b>{t('settings.achievementsRow')}</b>
              <small>{t('settings.achievementsCount', achievements)}</small>
            </span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
              <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        <p className="note">{t('settings.moduleOff')}</p>

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
        <p className="note">
          {t('settings.blockNote', {
            count: totals.totalBlocks,
            unit: plural('block', totals.totalBlocks),
            time: formatMinutes(totals.totalMinutes),
          })}
        </p>

        {/* Между ценой клика и данными намеренно: действие безопасное, и
            соседство с красной зоной читалось бы как угроза. В гостевом режиме
            раздела нет — гость уже внутри демо, и вложить в него второе демо
            значит потерять дорогу назад. */}
        {!GUEST_MODE && (
          <>
            <div className="divider-label">
              <span>{t('demo.title')}</span>
            </div>

            <button className="navrow press" type="button" onClick={onDemo}>
              <span className="navrow__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 11a3.2 3.2 0 100-6.4A3.2 3.2 0 009 11" />
                  <path d="M2.5 19.5v-1a4.5 4.5 0 014.5-4.5h4a4.5 4.5 0 014.5 4.5v1" />
                  <path d="M16.5 10.5a2.6 2.6 0 100-5.2M18 14.2a4 4 0 013.5 4v1.3" />
                </svg>
              </span>
              <span className="navrow__text">
                <b>{t('demo.settingsRow')}</b>
                <small>{t('demo.settingsNote')}</small>
              </span>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        )}

        <div className="divider-label">
          <span>{t('settings.dataTitle')}</span>
        </div>

        <ul className="sset__facts">
          {/* В демо строка обязана говорить «демо»: и «облако», и «это
              устройство» здесь были бы неправдой — данных нет нигде. */}
          <li>
            <span>{t('settings.where')}</span>
            {DEMO_MODE ? (
              <b className="warn">{t('demo.whereDemo')}</b>
            ) : (
              <b className={synced ? undefined : 'warn'}>
                {synced ? t('settings.whereCloud') : t('settings.whereLocal')}
              </b>
            )}
          </li>
          <li>
            <span>{t('settings.since')}</span>
            <b>{since ? formatDayShort(since) : t('common.nothing')}</b>
          </li>
          {/* Горизонт хранения был свойством прежней схемы: тринадцать месяцев
              брались из числа ключей в CloudStorage. У журнала такого предела
              нет, и с уходом записи в прежнее хранилище он исчез вовсе. */}
          <li>
            <span>{t('settings.retention')}</span>
            <b>{t('settings.retentionAll')}</b>
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
          {sync.kind !== 'off' && !GUEST_MODE && (
            <li>
              <span>{t('settings.account')}</span>
              <b className={sync.kind === 'signed-in' ? undefined : 'warn'}>
                {t(ACCOUNT_LABEL[sync.kind])}
              </b>
            </li>
          )}
          {/* Отметки сборки и сервера: «доехало ли на прод» должно быть видно,
              а не угадываться. Класс нужен сценарию скриншотов — иначе каждая
              пересборка меняла бы снимок настроек. */}
          <li className="sset__build">
            <span>{t('settings.build')}</span>
            <b>{buildLabel()}</b>
          </li>
          {sync.kind !== 'off' && !GUEST_MODE && (
            <li className="sset__build">
              <span>{t('settings.server')}</span>
              <b>{server ?? t('settings.serverUnknown')}</b>
            </li>
          )}
        </ul>

        {/*
         * Дальше — всё, что трогает аккаунт и данные владельца. Гостю этого
         * видеть не нужно, а кое-что и опасно: выход из аккаунта единственный
         * во всём приложении не прикрыт подменённым хранилищем — он гасит
         * сессию на сервере, а не на устройстве.
         *
         * Остальное в демо и так мертво (хранилище — память), но живая с виду
         * кнопка «Стереть историю» в чужих руках объясняется дольше, чем
         * прячется.
         */}
        {GUEST_MODE && <p className="note sset__gap">{t('demo.note')}</p>}

        {/* Вход вне Telegram: единственное место, где он вообще нужен. Внутри
            мини-аппа он молчаливый, и кнопки там быть не должно. */}
        {!GUEST_MODE && sync.kind === 'can-log-in' && (
          <>
            <p className="note">{t('settings.signInNote')}</p>
            <button className="btn press" type="button" onClick={() => void signIn()}>
              {t('settings.signIn')}
            </button>
          </>
        )}
        {!GUEST_MODE && sync.kind === 'signed-in' && !isTelegram && (
          <button
            className="btn-danger btn-danger--stack press"
            type="button"
            onClick={async () => {
              if (await confirmDialog(t('settings.signOutConfirm'))) await signOut();
            }}
          >
            {t('settings.signOut')}
          </button>
        )}

        {/* Молчаливый откат на локальное хранилище выглядит как пропажа данных:
            на телефоне всё есть, на компьютере пусто. Поэтому он назван вслух. */}
        {!GUEST_MODE && !synced && (
          <p className="note warn">
            {clientInfo.isTelegram ? t('settings.noSyncTelegram') : t('settings.noSyncBrowser')}
          </p>
        )}

        {!GUEST_MODE && (
          <>
            <button className="btn press" type="button" disabled={busy} onClick={exportData}>
              {t('settings.export')}
            </button>

            {/* Появляется только там, где есть что возвращать: копия снимается
                один раз, перед самым переходом на сервер. */}
            {hasBefore && (
              <button
                className="btn press sset__gap"
                type="button"
                disabled={busy}
                onClick={restoreBefore}
              >
                {t('settings.restoreBefore')}
              </button>
            )}

            <label className="btn press sset__gap sset__file">
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
                className="btn press sset__gap"
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
            {homeStatus === 'added' && <p className="note">{t('settings.homeScreenAdded')}</p>}

            <div className="divider-label">
              <span>{t('settings.resetTitle')}</span>
            </div>

            <button className="btn-danger btn-danger--stack press" type="button" disabled={busy} onClick={resetHistory}>
              <b>{t('settings.resetHistory')}</b>
              <small>{t('settings.resetHistoryNote')}</small>
            </button>

            <button className="btn-danger btn-danger--stack press" type="button" disabled={busy} onClick={resetEverything}>
              <b>{t('settings.resetAll')}</b>
              <small>{t('settings.resetAllNote')}</small>
            </button>

            <p className="note sset__gap">
              {isTelegram ? t('settings.resetScopeCloud') : t('settings.resetScopeLocal')}
              {DEMO_MODE && t('settings.mockNote')}
            </p>
          </>
        )}

        {/*
         * Брендкит — поверхность разработчика, и в собранном приложении этой
         * строки нет: справочник по классам обычному человеку не нужен, а лишний
         * пункт в настройках стоит дороже, чем кажется. В любой сборке он
         * остаётся доступен по адресу с ?brand — в том числе на телефоне, внутри
         * Telegram. Текст мимо i18n намеренно: строки не существует там, где
         * приложением пользуются.
         */}
        {BRAND_ROW && (
          <>
            <div className="divider-label">
              <span>Разработка</span>
            </div>

            <button className="navrow press" type="button" onClick={onBrand}>
              <span className="navrow__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 7h16M4 12h10M4 17h7" />
                  <path d="M17.5 13.5l3 3-3 3-3-3z" />
                </svg>
              </span>
              <span className="navrow__text">
                <b>Брендкит</b>
                <small>Цвета, шрифты, кнопки и компоненты одной страницей</small>
              </span>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        )}
      </div>
    </>
  );
}
