import { useMemo, useState } from 'react';

import { BatteryIcon } from '../components/BatteryIcon';
import { DayBars } from '../components/DayBars';
import { PeriodSwitch } from '../components/PeriodSwitch';
import { formatDayShort, formatHoursCompact, formatMinutes, formatPercent } from '../domain/date';
import { batteryTheme, batteryTitle, colorOf } from '../domain/palette';
import {
  clickStreak,
  computeBatteryStats,
  computeStats,
  dailyBreakdown,
  periodDays,
  type PriorityStat,
} from '../domain/stats';
import { BATTERY_LEVELS, PERIODS, blockMinutesOf, type PeriodId } from '../domain/types';
import { plural, t } from '../i18n';
import { useStore } from '../store/useStore';
import './StatsScreen.css';

const STATS_PERIODS = PERIODS.filter((p) => p.id !== 'today');

export function StatsScreen(): JSX.Element {
  const { settings, journal } = useStore();
  const [periodId, setPeriodId] = useState<PeriodId>('week');

  const period = STATS_PERIODS.find((p) => p.id === periodId) ?? STATS_PERIODS[0]!;
  const days = useMemo(() => periodDays(period, journal), [period, journal]);
  const stats = useMemo(() => computeStats(settings, journal, days), [settings, journal, days]);
  const battery = useMemo(() => computeBatteryStats(journal, days), [journal, days]);
  const streak = useMemo(() => clickStreak(journal), [journal]);
  const breakdown = useMemo(
    () => dailyBreakdown(settings, journal, days),
    [settings, journal, days],
  );
  const blockMinutes = blockMinutesOf(settings);

  const ranked = useMemo(
    () => [...stats.active, ...stats.archived].sort((a, b) => b.blocks - a.blocks),
    [stats],
  );

  const averagePerDay = days.length > 0 ? stats.totalMinutes / days.length : 0;

  return (
    <>
      <header className="header">
        <h1 className="header__title">{t('stats.title')}</h1>
      </header>

      <div className="app__body">
        <PeriodSwitch periods={STATS_PERIODS} value={periodId} onChange={setPeriodId} />

        <div className="tiles">
          <Tile value={formatHoursCompact(stats.totalMinutes)} label={t('stats.total')} />
          <Tile value={String(stats.totalBlocks)} label={plural('block', stats.totalBlocks)} />
          <Tile value={formatHoursCompact(averagePerDay)} label={t('stats.perDay')} />
          <Tile value={String(streak)} label={t('stats.streak', { unit: plural('day', streak) })} />
        </div>

        <div className="divider-label">
          <span>{t('stats.whereTime')}</span>
        </div>

        {stats.totalBlocks === 0 ? (
          <p className="empty">{t('stats.empty')}</p>
        ) : (
          <>
            <ul className="sbars">
              {ranked.map((stat) => (
                <StatBar key={stat.priority.id} stat={stat} />
              ))}
            </ul>

            <div className="divider-label">
              <span>{t('stats.byDays')}</span>
            </div>
            <p className="charge__note">{t('stats.byDaysNote')}</p>
            <DayBars breakdown={breakdown} blockMinutes={blockMinutes} />
          </>
        )}

        <div className="divider-label">
          <span>{t('stats.chargeTitle')}</span>
        </div>

        {battery.totalMinutes === 0 ? (
          <p className="empty">{t('stats.chargeEmpty')}</p>
        ) : (
          <>
            <div className="bstack">
              {BATTERY_LEVELS.map((level) => {
                const share = battery.minutes[level] / battery.totalMinutes;
                if (share <= 0) return null;
                const theme = batteryTheme(level);
                return (
                  <span
                    key={level}
                    className="bstack__seg"
                    style={{ width: `${share * 100}%`, background: theme.hex, boxShadow: `0 0 12px ${theme.hex}` }}
                    title={`${batteryTitle(level)}: ${formatPercent(share)}`}
                  />
                );
              })}
            </div>

            <ul className="blist">
              {BATTERY_LEVELS.map((level) => {
                const minutes = battery.minutes[level];
                return (
                  <li key={level} style={{ '--accent': batteryTheme(level).hex } as React.CSSProperties}>
                    <BatteryIcon level={level} width={30} dimmed={minutes === 0} glow={false} />
                    <span className="blist__title">{batteryTitle(level)}</span>
                    <span className="blist__time">{formatMinutes(minutes)}</span>
                    <span className="blist__share">
                      {formatPercent(battery.totalMinutes > 0 ? minutes / battery.totalMinutes : 0)}
                    </span>
                  </li>
                );
              })}
            </ul>

            <DayStrip days={days} perDay={battery.perDay} />
          </>
        )}
      </div>
    </>
  );
}

function Tile({ value, label }: { value: string; label: string }): JSX.Element {
  return (
    <div className="tile">
      <span className="tile__value">{value}</span>
      <span className="tile__label">{label}</span>
    </div>
  );
}

function StatBar({ stat }: { stat: PriorityStat }): JSX.Element {
  const color = colorOf(stat.priority.colorId);
  return (
    <li className="sbar" style={{ '--accent': color.hex, '--accent-soft': color.soft } as React.CSSProperties}>
      <div className="sbar__head">
        <span className="sbar__title">
          {stat.priority.title}
          {stat.archived && <span className="sbar__archived">{t('stats.archived')}</span>}
        </span>
        <span className="sbar__meta">
          <span className="sbar__time">{formatHoursCompact(stat.minutes)}</span>
          <span className="sbar__share">{formatPercent(stat.share)}</span>
        </span>
      </div>
      <span className="prow__track">
        <span className="prow__fill" style={{ width: `${stat.fill * 100}%` }} />
      </span>
    </li>
  );
}

/** Полоска по дням: каждый день окрашен доминирующим состоянием заряда. */
function DayStrip({
  days,
  perDay,
}: {
  days: string[];
  perDay: Record<string, number | null>;
}): JSX.Element {
  const first = days[0];
  const last = days[days.length - 1];

  return (
    <div className="dstrip">
      <div className="dstrip__bars">
        {days.map((day) => {
          const level = perDay[day];
          const hex = level ? batteryTheme(level as 1 | 2 | 3 | 4).hex : null;
          const label = level ? batteryTitle(level as 1 | 2 | 3 | 4) : t('stats.noData');
          return (
            <span
              key={day}
              className="dstrip__bar"
              title={`${formatDayShort(day)} — ${label}`}
              style={
                hex
                  ? { background: hex, boxShadow: `0 0 6px ${hex}` }
                  : { background: 'rgba(255,255,255,0.07)' }
              }
            />
          );
        })}
      </div>
      <div className="dstrip__axis">
        <span>{first ? formatDayShort(first) : ''}</span>
        <span>{last ? formatDayShort(last) : ''}</span>
      </div>
    </div>
  );
}
