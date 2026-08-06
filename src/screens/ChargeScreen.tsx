import { useMemo, useState } from 'react';

import { BatteryCaption, BatteryIcon } from '../components/BatteryIcon';
import { DrainSheet } from '../components/DrainSheet';
import { WallpaperSheet } from '../components/WallpaperSheet';
import { formatMinutes, formatPercent } from '../domain/date';
import { batteryMeaning, batteryTheme, batteryTitle } from '../domain/palette';
import { computeBatteryStats, currentBatteryLevel, periodDays } from '../domain/stats';
import { BATTERY_LEVELS, PERIODS } from '../domain/types';
import { t } from '../i18n';
import { useStore } from '../store/useStore';
import { haptics } from '../telegram/sdk';
import './ChargeScreen.css';

const TODAY = PERIODS.find((p) => p.id === 'today')!;

export function ChargeScreen(): JSX.Element {
  const { settings, journal, actions } = useStore();
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  const [askDrain, setAskDrain] = useState(false);

  const level = useMemo(() => currentBatteryLevel(journal), [journal]);
  const todayStats = useMemo(
    () => computeBatteryStats(journal, periodDays(TODAY, journal)),
    [journal],
  );

  const theme = level ? batteryTheme(level) : null;

  return (
    <>
      <header className="header">
        <h1 className="header__title">{t('charge.title')}</h1>
      </header>

      <div className="app__body" style={theme ? ({ '--accent': theme.hex } as React.CSSProperties) : undefined}>
        <div className="charge__hero">
          {level ? (
            <>
              <BatteryIcon level={level} width={168} />
              <BatteryCaption level={level} />
              {/* Расшифровка состояния уже стоит у выбранного пункта списка ниже,
                  поэтому здесь — то, чего там нет: сколько вы сегодня так прожили. */}
              <p className="charge__meaning">
                {todayStats.minutes[level] > 0
                  ? t('charge.todayIn', { time: formatMinutes(todayStats.minutes[level]) })
                  : t('charge.started')}
              </p>
            </>
          ) : (
            <>
              <BatteryIcon level={2} width={168} dimmed />
              <p className="charge__meaning">{t('charge.unset')}</p>
            </>
          )}
        </div>

        <div className="divider-label">
          <span>{t('charge.pickTitle')}</span>
        </div>

        <p className="charge__note">{t('charge.pickNote')}</p>

        <ul className="charge__list">
          {BATTERY_LEVELS.map((option) => {
            const optionTheme = batteryTheme(option);
            const active = level === option;
            const minutes = todayStats.minutes[option];
            return (
              <li key={option}>
                <button
                  className={`charge__option press${active ? ' charge__option--on' : ''}`}
                  style={{ '--accent': optionTheme.hex } as React.CSSProperties}
                  type="button"
                  onClick={() => {
                    if (active) return;
                    haptics.bump();
                    actions.setBattery(option);
                    // Спрашиваем только на переходе «на нуле» и только если есть
                    // из чего выбирать — иначе вопрос превращается в пустую модалку.
                    if (option === 1 && settings.priorities.length > 0) setAskDrain(true);
                  }}
                >
                  <BatteryIcon level={option} width={48} dimmed={!active} glow={active} />
                  <span className="charge__option-text">
                    <b>{batteryTitle(option)}</b>
                    <small>{batteryMeaning(option)}</small>
                  </span>
                  {minutes > 0 && <span className="charge__today">{formatMinutes(minutes)}</span>}
                </button>
              </li>
            );
          })}
        </ul>

        {todayStats.totalMinutes > 0 && (
          <>
            <div className="divider-label">
              <span>{t('charge.todayTitle')}</span>
            </div>
            <div className="bstack">
              {BATTERY_LEVELS.map((option) => {
                const share = todayStats.minutes[option] / todayStats.totalMinutes;
                if (share <= 0) return null;
                const hex = batteryTheme(option).hex;
                return (
                  <span
                    key={option}
                    className="bstack__seg"
                    style={{ width: `${share * 100}%`, background: hex, boxShadow: `0 0 12px ${hex}` }}
                    title={`${batteryTitle(option)}: ${formatPercent(share)}`}
                  />
                );
              })}
            </div>
            <p className="charge__note">{t('charge.todayNote')}</p>
          </>
        )}

        <div className="divider-label">
          <span>{t('charge.wallpaperTitle')}</span>
        </div>

        <p className="charge__note">{t('charge.wallpaperNote')}</p>

        <button className="edit__add press charge__wallpaper" type="button" onClick={() => setWallpaperOpen(true)}>
          {t('charge.wallpaperAction')}
        </button>
      </div>

      <WallpaperSheet
        open={wallpaperOpen}
        initialLevel={level ?? 3}
        onClose={() => setWallpaperOpen(false)}
      />

      <DrainSheet
        open={askDrain}
        priorities={settings.priorities}
        onAnswer={(drainedBy) => {
          actions.setDrain(drainedBy);
          setAskDrain(false);
        }}
        onSkip={() => setAskDrain(false)}
      />
    </>
  );
}
