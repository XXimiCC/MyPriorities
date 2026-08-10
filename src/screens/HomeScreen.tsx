import { useEffect, useMemo, useRef, useState } from 'react';

import { BlockTuner } from '../components/BlockTuner';
import { HeaderBattery } from '../components/HeaderBattery';
import { PeriodSwitch } from '../components/PeriodSwitch';
import { PriorityRow } from '../components/PriorityRow';
import { Sheet } from '../components/Sheet';
import { DayPicker } from '../components/DayPicker';
import { formatDayShort, formatMinutes, formatPercent } from '../domain/date';
import { colorOf } from '../domain/palette';
import { computeStats, periodDays } from '../domain/stats';
import { PERIODS, type PeriodId } from '../domain/periods';
import { blockMinutesOf, type DayKey, type Priority } from '../domain/types';
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
  const [tuning, setTuning] = useState<Priority | null>(null);
  /**
   * День, в который идут клики. Живёт в состоянии экрана, а не в сторе, и
   * поэтому сбрасывается на сегодня при каждом открытии приложения. Это и есть
   * защита от главного риска режима: забыть, что пишешь во вчера, и потерять
   * весь следующий день.
   */
  const [writeDay, setWriteDay] = useState<DayKey>(today);
  const [pickerOpen, setPickerOpen] = useState(false);

  /*
   * Наступила полночь при открытом приложении — переводим запись на новые сутки.
   *
   * Триггер именно смена даты, а не сравнение writeDay с today: в режиме прошлого
   * дня они расходятся намеренно, и сравнение сбрасывало бы выбор сразу же. Прежнее
   * условие `writeDay > today` не срабатывало никогда — лента предлагает только
   * прошедшие дни, — и после полуночи клики молча продолжали уходить во вчера.
   *
   * Забытое «пишу во вчера» сбрасывается здесь по той же причине, по какой режим
   * не переживает перезапуск: иначе он съел бы следующие сутки целиком.
   */
  const lastToday = useRef(today);
  useEffect(() => {
    if (lastToday.current === today) return;
    lastToday.current = today;
    setWriteDay(today);
    setPickerOpen(false);
  }, [today]);

  const inPast = writeDay !== today;

  const period = HOME_PERIODS.find((p) => p.id === periodId) ?? HOME_PERIODS[0]!;

  /*
   * В режиме прошлого дня «сегодня» означает выбранный день, а не текущие сутки.
   *
   * Без этого экран показывал итоги сегодняшнего дня, пока клики уходили во
   * вчерашний: нажимаешь «+», а строка не меняется — и выглядит это как будто
   * клик не засчитался. Недельное и месячное окна остаются скользящими: они тут
   * как контекст, и привязывать их к выбранному дню незачем.
   */
  const days = useMemo(
    () => (inPast && periodId === 'today' ? [writeDay] : periodDays(period, journal)),
    [inPast, periodId, writeDay, period, journal],
  );
  const stats = useMemo(
    () => computeStats(settings, journal, days),
    [settings, journal, days],
  );
  // Точки у кнопки «+» показывают тот день, в который идёт запись, а не сегодня:
  // иначе в режиме прошлого дня счётчик врал бы о том, что вы только что нажали.
  const dayClicks = journal.clicks[writeDay] ?? {};
  const blockMinutes = blockMinutesOf(settings);

  /**
   * Выбор дня в ленте. Переключатель периода уводится на «сегодня», потому что
   * выбранный день виден только там: остаться на недельном окне значило бы
   * выбрать день и не увидеть его.
   */
  const pickDay = (day: DayKey): void => {
    setWriteDay(day);
    if (day !== today) setPeriodId('today');
  };

  const leader = stats.active.reduce<typeof stats.active[number] | null>(
    (best, stat) => (!best || stat.blocks > best.blocks ? stat : best),
    null,
  );

  const scope =
    periodId !== 'today'
      ? t('home.scopePeriod', { period: t(period.labelKey).toLowerCase() })
      : inPast
        ? t('home.scopeDay', { day: formatDayShort(writeDay) })
        : t('home.scopeToday');

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
          <HeaderBattery />
        </div>
      </header>

      {/* Переключатель периода и итог остаются на месте: прокручивается только список. */}
      <div className="app__sticky">
        <PeriodSwitch periods={HOME_PERIODS} value={periodId} onChange={setPeriodId} />

        {/*
          Итог периода и кнопка записи в прошлый день стоят в одной строке:
          кнопка справа, на уровне итога. Место у неё одно и то же и под
          «Дописать», и под «Свернуть» — иначе управление лентой прыгало бы над
          ней и под неё.
        */}
        <div className="home__head">
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

          {/* В режиме прошлого дня ленту закрывает «К сегодня» из предупреждения
              ниже: вторая кнопка рядом означала бы два разных выхода из режима. */}
          {!inPast && (
            <button
              className="home__gaps press"
              type="button"
              onClick={() => setPickerOpen(!pickerOpen)}
            >
              {pickerOpen ? (
                t('home.hidePicker')
              ) : (
                <>
                  {/* Стрелка против часовой: вернуться назад по времени и дописать. */}
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
                    <path
                      d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M3 3v5h5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {t('home.fillGaps')}
                </>
              )}
            </button>
          )}
        </div>

        {(pickerOpen || inPast) && (
          <DayPicker
            value={writeDay}
            hasEntries={(day) => {
              const entry = journal.clicks[day];
              return Boolean(entry && Object.values(entry).some((n) => n > 0));
            }}
            onChange={pickDay}
          />
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
                // Запись в прошлый день из журнала не восстановить: клик за
                // вчера выглядит там ровно как сделанный вчера.
                if (inPast) actions.award('r8');
              }}
              onOpen={() => setTuning(stat.priority)}
              onHold={onEdit}
            />
          ))}
        </ul>

        {stats.active.length > 0 && <p className="home__hint">{t('home.holdHint')}</p>}
      </div>

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
        <div style={{ '--accent': color.hex } as React.CSSProperties}>
          <BlockTuner
            blocks={blocks}
            blockMinutes={blockMinutes}
            caption={
              day === today
                ? t('home.todayBlocks', { count: blocks, unit: plural('block', blocks) })
                : t('home.dayBlocks', {
                    count: blocks,
                    unit: plural('block', blocks),
                    day: formatDayShort(day),
                  })
            }
            onAdd={() => actions.addBlock(priority.id, day)}
            onRemove={() => actions.removeBlock(priority.id, day)}
          />
        </div>
      )}
    </Sheet>
  );
}
