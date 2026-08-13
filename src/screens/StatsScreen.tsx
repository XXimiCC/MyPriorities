import { useMemo, useState, type ReactNode } from 'react';

import { BatteryIcon } from '../components/BatteryIcon';
import { DayBars } from '../components/DayBars';
import { EnergyChart } from '../components/EnergyChart';
import { HeaderBattery } from '../components/HeaderBattery';
import { PeriodSwitch } from '../components/PeriodSwitch';
import { formatHoursCompact, formatMinutes, formatPercent } from '../domain/date';
import { batteryTheme, batteryTitle, colorOf } from '../domain/palette';
import {
  clickStreak,
  computeBatteryStats,
  computeStats,
  dailyBreakdown,
  drainCounts,
  periodDays,
  type PriorityStat,
} from '../domain/stats';
import { MAX_INSIGHTS, insightText, insights, type Insight } from '../domain/insights';
import { PERIODS, type PeriodId } from '../domain/periods';
import { BATTERY_LEVELS, blockMinutesOf, drainTextOf, modulesOf } from '../domain/types';
import { derive } from '../achievements/derive';
import { plural, t } from '../i18n';
import { useStore } from '../store/useStore';
import './StatsScreen.css';

const STATS_PERIODS = PERIODS.filter((p) => p.id !== 'today');

/**
 * Наблюдение с выделенным именем приоритета.
 *
 * Текст собирается в domain/insights.ts обычной строкой, а цвет живёт отдельным
 * полем: подставлять разметку в словарь нельзя — строки переводятся и
 * проверяются как текст. Поэтому имя ищется в готовой фразе по тому же
 * значению, которым его туда подставили.
 *
 * Найти не удалось — показываем как есть: наблюдение без цвета читается, а
 * упавший экран статистики — нет.
 */
function withNamedPriority(note: Insight): ReactNode {
  const text = insightText(note);
  const title = typeof note.params?.title === 'string' ? note.params.title : undefined;
  if (!title || note.colorId === undefined) return text;

  const at = text.indexOf(title);
  if (at < 0) return text;

  return (
    <>
      {text.slice(0, at)}
      <b className="ins__name" style={{ color: colorOf(note.colorId).hex }}>
        {title}
      </b>
      {text.slice(at + title.length)}
    </>
  );
}

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

  const drains = useMemo(() => {
    const known = new Map(
      [...settings.priorities, ...settings.archived].map((p) => [p.id, p]),
    );
    return [...drainCounts(journal, days)]
      .map(([id, count]) => {
        const priority = known.get(id);
        // Ответ своими словами показывается как есть: он и был подписью строки,
        // когда его писали. Одинаковые тексты уже сложены в один ключ.
        const own = drainTextOf(id);
        return {
          id: id || 'unknown',
          count,
          title: priority ? priority.title : own ?? t('drain.unknown'),
          hex: priority ? colorOf(priority.colorId).hex : 'var(--text-faint)',
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [settings, journal, days]);

  const averagePerDay = days.length > 0 ? stats.totalMinutes / days.length : 0;

  // Наблюдения намеренно не зависят от days: у них свои окна, и они не должны
  // меняться вместе с переключателем периода — иначе «неделя против прошлой»
  // означало бы разное в зависимости от того, что выбрано выше.
  const modules = modulesOf(settings);
  const notes = useMemo(
    () => (modules.insights ? insights(settings, derive(settings, journal)) : []),
    [modules.insights, settings, journal],
  );

  return (
    <>
      <header className="header">
        <h1 className="header__title">{t('stats.title')}</h1>
        <div className="header__actions">
          <HeaderBattery />
        </div>
      </header>

      <div className="app__body">
        <PeriodSwitch periods={STATS_PERIODS} value={periodId} onChange={setPeriodId} />

        <div className="tiles">
          <Tile value={formatHoursCompact(stats.totalMinutes)} label={t('stats.total')} />
          <Tile value={String(stats.totalBlocks)} label={plural('block', stats.totalBlocks)} />
          <Tile value={formatHoursCompact(averagePerDay)} label={t('stats.perDay')} />
          <Tile value={String(streak)} label={t('stats.streak', { unit: plural('day', streak) })} />
        </div>

        {notes.length > 0 && (
          <>
            <div className="divider-label">
              <span>{t('ins.title')}</span>
            </div>
            <ul className="ins">
              {notes.slice(0, MAX_INSIGHTS).map((note) => (
                <li className="ins__item" key={note.id}>
                  {withNamedPriority(note)}
                </li>
              ))}
            </ul>
          </>
        )}

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

            <div className="divider-label">
              <span>{t('stats.energyTitle')}</span>
            </div>
            <p className="charge__note">{t('stats.energyNote')}</p>
            <EnergyChart days={days} battery={battery} />

            <div className="divider-label">
              <span>{t('drain.statsTitle')}</span>
            </div>
            <p className="charge__note">{t('drain.statsNote')}</p>
            {drains.length === 0 ? (
              <p className="empty">{t('drain.statsEmpty')}</p>
            ) : (
              <ul className="blist">
                {drains.map((row) => (
                  <li key={row.id} style={{ '--accent': row.hex } as React.CSSProperties}>
                    <span className="swatch" />
                    <span className="blist__title">{row.title}</span>
                    <span className="blist__share">
                      {/* Считаются переходы, а не дни: «3 раза», а не «3 дня». */}
                      {t('drain.statsCount', { count: row.count, unit: plural('times', row.count) })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
      <span className="bar">
        <span className="bar__fill" style={{ width: `${stat.fill * 100}%` }} />
      </span>
    </li>
  );
}

