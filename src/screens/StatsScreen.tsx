import { useEffect, useMemo, useState, type ReactNode } from 'react';

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
  initialPeriod,
  periodDays,
  type PriorityStat,
} from '../domain/stats';
import { MAX_INSIGHTS, insightText, insights, type Insight } from '../domain/insights';
import { historyAge, historyDays, localOnlyDue } from '../domain/localOnly';
import { PERIODS, type PeriodId } from '../domain/periods';
import { BATTERY_LEVELS, blockMinutesOf, drainTextOf, modulesOf } from '../domain/types';
import { derive } from '../achievements/derive';
import { DEMO_MODE, GUEST_MODE } from '../demo/mode';
import { plural, t } from '../i18n';
import { useStore } from '../store/useStore';
import { signIn, subscribeSync, syncState, type SyncState } from '../sync/auth';
import { exportCopy } from './exportCopy';
import './StatsScreen.css';

const STATS_PERIODS = PERIODS.filter((p) => p.id !== 'today');

/** Строка блока «что сажает батарею»: приоритет, свой ответ или «не знаю». */
interface DrainRow {
  id: string;
  count: number;
  title: string;
  hex: string;
}

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

interface Props {
  /** Витрина демо-профилей: единственная ссылка отсюда наружу. */
  onDemo(): void;
}

export function StatsScreen({ onDemo }: Props): JSX.Element {
  const { settings, journal, actions } = useStore();
  /* Начальный период выбирается по журналу — см. initialPeriod. Ленивый
     инициализатор, а не эффект: посчитать надо до первой отрисовки, иначе
     вернувшийся успеет увидеть пустое окно, и один раз за открытие экрана,
     потому что дальше периодами распоряжается человек. */
  const [periodId, setPeriodId] = useState<PeriodId>(() => initialPeriod(journal));
  const [busy, setBusy] = useState(false);
  const [sync, setSync] = useState<SyncState>(syncState);

  // Вход идёт фоном и может закончиться уже после того, как экран открыли.
  useEffect(() => subscribeSync(setSync), []);

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

  const drains = useMemo<DrainRow[]>(() => {
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

  /*
   * «Эта история есть только здесь» — одна строка, один раз в жизни кабинета.
   *
   * В демо не показывается вовсе: история там синтетическая, а хранилище —
   * память, поэтому и закрыть её насовсем было бы нечем. Пока вход ещё идёт
   * (`working`), тоже молчим: внутри Telegram он молчаливый и заканчивается уже
   * после того, как экран открыли, — иначе строка мигала бы у вошедшего.
   */
  const historyLength = useMemo(() => historyDays(journal), [journal]);
  const showLocalOnly =
    !DEMO_MODE &&
    sync.kind !== 'working' &&
    localOnlyDue(settings, historyLength, sync.kind === 'signed-in');

  const takeCopy = (): void => {
    if (busy) return;
    setBusy(true);
    void exportCopy(actions).finally(() => setBusy(false));
  };

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

        {/*
          Стоит сразу под плитками, а не в конце экрана: строка про единственный
          экземпляр истории должна попасться на глаза тому, кто открыл
          статистику посмотреть, а не тому, кто домотал её до низа. На главный
          экран это не ставится намеренно — там не должно быть ничего, кроме
          «отметить».
        */}
        {showLocalOnly && (
          <div className="lonly">
            <p className="lonly__text">
              {t('stats.localOnly', { age: historyAge(historyLength) })}
            </p>
            <div className="lonly__acts">
              <button
                className="lonly__act press"
                type="button"
                disabled={busy}
                onClick={takeCopy}
              >
                {t('stats.localOnlyExport')}
              </button>
              {/* Ровно там же, где кнопка входа в настройках: внутри Telegram
                  вход молчаливый, и предлагать его нажатием нечего. */}
              {sync.kind === 'can-log-in' && (
                <button className="lonly__act press" type="button" onClick={() => void signIn()}>
                  {t('stats.localOnlySignIn')}
                </button>
              )}
              <button
                className="lonly__act lonly__act--quiet press"
                type="button"
                onClick={() => actions.markOnce('localOnlySeen')}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        )}

        {/*
          Заголовок стоит и до первого наблюдения — иначе включённый тумблер
          «Наблюдения» первую неделю не делает ничего, и проверить, что он
          вообще работает, человеку нечем. Выключенный модуль по-прежнему
          убирает блок целиком.
        */}
        {modules.insights && (
          <>
            <div className="divider-label">
              <span>{t('ins.title')}</span>
            </div>
            {notes.length > 0 ? (
              <ul className="ins">
                {notes.slice(0, MAX_INSIGHTS).map((note) => (
                  <li className="ins__item" key={note.id}>
                    {withNamedPriority(note)}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="ins">
                {/* Одна строка факта, без совета и без обещания конкретной
                    карточки: какая наберётся первой, заранее не знает никто. */}
                <p className="ins__item">{t('ins.soon')}</p>
                {/* Готовая история уже написана, но лежит в настройках, куда
                    новичок не идёт. Гостю ссылка не нужна: он уже внутри демо. */}
                {!GUEST_MODE && (
                  <button className="ins__demo press" type="button" onClick={onDemo}>
                    {t('ins.soonDemo')}
                  </button>
                )}
              </div>
            )}
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

        {/*
          Условие — «отмечали ли вообще», а не «набежало ли время».

          Текущие сутки считаются только до «сейчас» (см. computeBatteryStats),
          поэтому только что поставленная отметка длится ноль минут — и по
          длительности целый период неотличим от нетронутого. Разделены оба
          случая: «ещё не отмечали» и «отметка есть, времени пока нет». Второе
          проходит само в течение минуты, но сказать в эту минуту «вы ещё не
          отмечали» — это соврать человеку про то, что он только что сделал.
          Экран «Заряд» отвечает на тот же ноль словами «часы идут».
        */}
        {!battery.marked ? (
          <p className="empty">{t('stats.chargeEmpty')}</p>
        ) : battery.totalMinutes === 0 ? (
          <>
            <p className="empty">{t('stats.chargeFresh')}</p>
            <Drains drains={drains} />
          </>
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

            <Drains drains={drains} />
          </>
        )}
      </div>
    </>
  );
}

/**
 * «Что сажает батарею» — отдельным блоком, потому что показывается в двух
 * ветках: и когда время по уровням набежало, и в ту минуту, когда отметка
 * только поставлена. Ответ на вопрос про причину не зависит от длительности,
 * и прятать его вместе со шкалой было бы потерей единственного, что уже есть.
 */
function Drains({ drains }: { drains: DrainRow[] }): JSX.Element {
  return (
    <>
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

