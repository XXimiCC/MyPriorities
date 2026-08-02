import { useMemo, useState } from 'react';

import { BatteryIcon } from '../components/BatteryIcon';
import { BatterySheet } from '../components/BatterySheet';
import { PeriodSwitch } from '../components/PeriodSwitch';
import { PriorityRow } from '../components/PriorityRow';
import { Sheet } from '../components/Sheet';
import { formatHoursCompact, formatMinutes, formatPercent } from '../domain/date';
import { colorOf } from '../domain/palette';
import { computeStats, currentBatteryLevel, periodDays } from '../domain/stats';
import { PERIODS, blockMinutesOf, type PeriodId, type Priority } from '../domain/types';
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

  const period = HOME_PERIODS.find((p) => p.id === periodId) ?? HOME_PERIODS[0]!;
  const stats = useMemo(
    () => computeStats(settings, journal, periodDays(period, journal)),
    [settings, journal, period],
  );
  const battery = useMemo(() => currentBatteryLevel(journal), [journal]);
  const todayClicks = journal.clicks[today] ?? {};
  const blockMinutes = blockMinutesOf(settings);

  const leader = stats.active.reduce<typeof stats.active[number] | null>(
    (best, stat) => (!best || stat.blocks > best.blocks ? stat : best),
    null,
  );

  return (
    <>
      <header className="header">
        <h1 className="header__title">Мои приоритеты</h1>
        <div className="header__actions">
          <button className="header__btn press" onClick={onEdit} type="button" aria-label="Изменить приоритеты">
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
            aria-label="Состояние батареи"
          >
            {battery ? (
              <BatteryIcon level={battery} width={36} />
            ) : (
              <span className="header__battery-empty">Заряд?</span>
            )}
          </button>
        </div>
      </header>

      {/* Переключатель периода и итог остаются на месте: прокручивается только список. */}
      <div className="app__sticky">
        <PeriodSwitch periods={HOME_PERIODS} value={periodId} onChange={setPeriodId} />

        {stats.totalBlocks === 0 ? (
          <p className="home__lead home__lead--empty">
            Каждый клик по «+» — это {blockMinutes}{' '}
            {plural(blockMinutes, 'минута', 'минуты', 'минут')} жизни, вложенные в приоритет.
          </p>
        ) : (
          <p className="home__lead">
            {periodId === 'today' ? 'Сегодня' : `За ${period.label.toLowerCase()}`} —{' '}
            <strong>{formatMinutes(stats.totalMinutes)}</strong>
            {/* Название подставляется как есть: склонять его в шаблоне нечем,
                а «больше всего в работа» читается как ошибка. */}
            {leader && leader.blocks > 0 && (
              <>
                . Лидер:{' '}
                <span style={{ color: colorOf(leader.priority.colorId).hex }}>
                  {leader.priority.title}
                </span>
                , {formatPercent(leader.share)}
              </>
            )}
          </p>
        )}
      </div>

      <div className="app__body">
        <ul className="home__list">
          {stats.active.map((stat) => (
            <PriorityRow
              key={stat.priority.id}
              stat={stat}
              todayBlocks={todayClicks[stat.priority.id] ?? 0}
              onAdd={() => {
                haptics.tap();
                actions.addBlock(stat.priority.id);
              }}
              onOpen={() => setTuning(stat.priority)}
              onHold={onEdit}
            />
          ))}
        </ul>

        {stats.active.length > 0 && (
          <p className="home__hint">Удерживайте приоритет, чтобы изменить список</p>
        )}

        {stats.active.length === 0 && (
          <p className="empty">Ни одного приоритета. Добавьте их вручную или выберите готовый набор.</p>
        )}
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

      <TuneSheet priority={tuning} onClose={() => setTuning(null)} />
    </>
  );
}

/** Правка сегодняшнего счётчика: сюда попадают, когда «+» нажали лишний раз. */
function TuneSheet({ priority, onClose }: { priority: Priority | null; onClose(): void }): JSX.Element {
  const { settings, journal, today, actions } = useStore();
  const blocks = priority ? journal.clicks[today]?.[priority.id] ?? 0 : 0;
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
            aria-label="Убрать 30 минут"
            onClick={() => {
              haptics.tap();
              actions.removeBlock(priority.id);
            }}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M5.5 12h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>

          <div className="tune__value">
            <span className="tune__time">{formatHoursCompact(blocks * blockMinutes)}</span>
            <span className="tune__blocks">
              {blocks} {plural(blocks, 'блок', 'блока', 'блоков')} сегодня
            </span>
          </div>

          <button
            className="tune__btn press"
            type="button"
            aria-label="Добавить 30 минут"
            onClick={() => {
              haptics.tap();
              actions.addBlock(priority.id);
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

export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
