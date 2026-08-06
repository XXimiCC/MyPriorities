import { useEffect, useMemo, useState } from 'react';

import { BatteryIcon } from '../components/BatteryIcon';
import { BatterySheet } from '../components/BatterySheet';
import { PeriodSwitch } from '../components/PeriodSwitch';
import { PriorityRow } from '../components/PriorityRow';
import { Sheet } from '../components/Sheet';
import { DayPicker } from '../components/DayPicker';
import { formatDayShort, formatHoursCompact, formatMinutes, formatPercent } from '../domain/date';
import { colorOf } from '../domain/palette';
import { computeStats, currentBatteryLevel, periodDays } from '../domain/stats';
import { PERIODS, blockMinutesOf, type DayKey, type PeriodId, type Priority } from '../domain/types';
import { plural, t } from '../i18n';
import { useStore } from '../store/useStore';
import { haptics } from '../telegram/sdk';
import './HomeScreen.css';

const HOME_PERIODS = PERIODS.filter((p) => p.id !== 'all');

interface Props {
  onEdit(): void;
}

export function HomeScreen({ onEdit }: Props): JSX.Element {
  const { settings, journal, today, actions } = useStore();
  const [periodId, setPeriodId] = useState<PeriodId>('today');
  const [batteryOpen, setBatteryOpen] = useState(false);
  const [tuning, setTuning] = useState<Priority | null>(null);
  /**
   * День, в который идут клики. Живёт в состоянии экрана, а не в сторе, и
   * поэтому сбрасывается на сегодня при каждом открытии приложения. Это и есть
   * защита от главного риска режима: забыть, что пишешь во вчера, и потерять
   * весь следующий день.
   */
  const [writeDay, setWriteDay] = useState<DayKey>(today);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Наступила полночь при открытом приложении — переводим запись на новые сутки.
  useEffect(() => {
    if (writeDay > today) setWriteDay(today);
  }, [today, writeDay]);

  const inPast = writeDay !== today;

  const period = HOME_PERIODS.find((p) => p.id === periodId) ?? HOME_PERIODS[0]!;
  const stats = useMemo(
    () => computeStats(settings, journal, periodDays(period, journal)),
    [settings, journal, period],
  );
  const battery = useMemo(() => currentBatteryLevel(journal), [journal]);
  // Точки у кнопки «+» показывают тот день, в который идёт запись, а не сегодня:
  // иначе в режиме прошлого дня счётчик врал бы о том, что вы только что нажали.
  const dayClicks = journal.clicks[writeDay] ?? {};
  const blockMinutes = blockMinutesOf(settings);

  const leader = stats.active.reduce<typeof stats.active[number] | null>(
    (best, stat) => (!best || stat.blocks > best.blocks ? stat : best),
    null,
  );

  const scope =
    periodId === 'today'
      ? t('home.scopeToday')
      : t('home.scopePeriod', { period: t(period.labelKey).toLowerCase() });

  return (
    <>
      <header className="header">
        <h1 className="header__title">{t('app.title')}</h1>
        <div className="header__actions">
          <button className="header__btn press" onClick={onEdit} type="button" aria-label={t('home.edit')}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
              <path
                d="M4 20h4l10-10a2.5 2.5 0 10-3.5-3.5L4.5 16.5V20z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            className="header__battery press"
            onClick={() => setBatteryOpen(true)}
            type="button"
            aria-label={t('home.battery')}
          >
            {battery ? (
              <BatteryIcon level={battery} width={36} />
            ) : (
              <span className="header__battery-empty">{t('home.batteryEmpty')}</span>
            )}
          </button>
        </div>
      </header>

      {/* Переключатель периода и итог остаются на месте: прокручивается только список. */}
      <div className="app__sticky">
        <PeriodSwitch periods={HOME_PERIODS} value={periodId} onChange={setPeriodId} />

        {stats.totalBlocks === 0 ? (
          <p className="home__lead home__lead--empty">
            {t('home.empty', { minutes: blockMinutes, unit: plural('minute', blockMinutes) })}
          </p>
        ) : (
          <p className="home__lead">
            {t('home.total', { scope })}
            <strong>{formatMinutes(stats.totalMinutes)}</strong>
            {/* Название подставляется как есть: склонять его в шаблоне нечем,
                а «больше всего в работа» читается как ошибка. */}
            {leader && leader.blocks > 0 && (
              <>
                {t('home.leader')}
                <span style={{ color: colorOf(leader.priority.colorId).hex }}>
                  {leader.priority.title}
                </span>
                , {formatPercent(leader.share)}
              </>
            )}
          </p>
        )}

        {pickerOpen || inPast ? (
          <DayPicker value={writeDay} journal={journal} onChange={setWriteDay} />
        ) : (
          <button className="home__gaps" type="button" onClick={() => setPickerOpen(true)}>
            {t('home.fillGaps')}
          </button>
        )}

        {inPast && (
          <div className="dpast">
            <span>{t('home.pastWarning', { day: formatDayShort(writeDay) })}</span>
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                setWriteDay(today);
                setPickerOpen(false);
              }}
            >
              {t('home.backToToday')}
            </button>
          </div>
        )}
      </div>

      <div className="app__body">
        <ul className="home__list">
          {stats.active.map((stat) => (
            <PriorityRow
              key={stat.priority.id}
              stat={stat}
              todayBlocks={dayClicks[stat.priority.id] ?? 0}
              blockMinutes={blockMinutes}
              onAdd={() => {
                haptics.tap();
                actions.addBlock(stat.priority.id, writeDay);
              }}
              onOpen={() => setTuning(stat.priority)}
              onHold={onEdit}
            />
          ))}
        </ul>

        {stats.active.length > 0 && <p className="home__hint">{t('home.holdHint')}</p>}
      </div>

      <BatterySheet
        open={batteryOpen}
        current={battery}
        onPick={(level) => {
          actions.setBattery(level);
          setBatteryOpen(false);
        }}
        onClose={() => setBatteryOpen(false)}
      />

      <TuneSheet priority={tuning} day={writeDay} onClose={() => setTuning(null)} />
    </>
  );
}

/** Правка счётчика за выбранный день: сюда попадают, когда «+» нажали лишний раз. */
function TuneSheet({
  priority,
  day,
  onClose,
}: {
  priority: Priority | null;
  day: DayKey;
  onClose(): void;
}): JSX.Element {
  const { settings, journal, today, actions } = useStore();
  const blocks = priority ? journal.clicks[day]?.[priority.id] ?? 0 : 0;
  const color = priority ? colorOf(priority.colorId) : null;
  const blockMinutes = blockMinutesOf(settings);

  return (
    <Sheet open={Boolean(priority)} title={priority?.title} onClose={onClose}>
      {priority && color && (
        <div className="tune" style={{ '--accent': color.hex } as React.CSSProperties}>
          <button
            className="tune__btn press"
            type="button"
            disabled={blocks === 0}
            aria-label={t('home.minus', { minutes: blockMinutes })}
            onClick={() => {
              haptics.tap();
              actions.removeBlock(priority.id, day);
            }}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M5.5 12h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>

          <div className="tune__value">
            <span className="tune__time">{formatHoursCompact(blocks * blockMinutes)}</span>
            <span className="tune__blocks">
              {day === today
                ? t('home.todayBlocks', { count: blocks, unit: plural('block', blocks) })
                : t('home.dayBlocks', {
                    count: blocks,
                    unit: plural('block', blocks),
                    day: formatDayShort(day),
                  })}
            </span>
          </div>

          <button
            className="tune__btn press"
            type="button"
            aria-label={t('home.plus', { minutes: blockMinutes })}
            onClick={() => {
              haptics.tap();
              actions.addBlock(priority.id, day);
            }}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M12 5.5v13M5.5 12h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
    </Sheet>
  );
}
