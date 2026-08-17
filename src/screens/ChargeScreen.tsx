import { useEffect, useMemo, useRef, useState } from 'react';

import { BatteryCaption, BatteryIcon } from '../components/BatteryIcon';
import { usePickBattery } from '../components/BatteryPrompt';
import { BatteryShiftSheet, type EditedShift } from '../components/BatteryShiftSheet';
import { DayPicker } from '../components/DayPicker';
import { HeaderBattery } from '../components/HeaderBattery';
import { WallpaperSheet } from '../components/WallpaperSheet';
import { useNow } from '../components/useNow';
import { formatTime } from '../domain/battery';
import { formatDayShort, formatMinutes, formatPercent, minuteOfDay, todayKey } from '../domain/date';
import { batteryMeaning, batteryTheme, batteryTitle } from '../domain/palette';
import { computeBatteryStats, currentBatteryLevel, levelBefore } from '../domain/stats';
import { BATTERY_LEVELS } from '../domain/types';
import { t } from '../i18n';
import { useStore } from '../store/useStore';
import { haptics } from '../telegram/sdk';
import './ChargeScreen.css';

const MINUTES_IN_DAY = 1440;

export function ChargeScreen(): JSX.Element {
  const { journal, actions } = useStore();
  const pick = usePickBattery();
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  /*
   * Часы экрана. Всё здесь — длительности: «сегодня в этом состоянии», хвост
   * последней отметки, предел времени в шторке. Считать их от журнала, как
   * было раньше, значит замирать до следующей записи, а её может не быть весь
   * день. Отсюда же берутся сутки: раз время идёт по этим часам, то и день
   * должен меняться по ним, а не по второму источнику.
   */
  const now = useNow();
  const today = todayKey(now);

  /** День, отметки которого правим. Начинаем с сегодняшнего и держимся за него. */
  const [editDay, setEditDay] = useState(today);
  const [editing, setEditing] = useState<EditedShift | null>(null);

  /*
   * Наступила полночь при открытом приложении — переезжаем на новые сутки.
   *
   * Экран открывают вечером, а возвращаются к нему утром, и до этого правка
   * молча оставалась на вчерашнем дне: «Добавить отметку» подставляла полдень
   * и писала отметку во вчера. То же, что на главной и в навыках, и по той же
   * причине. Открытая шторка закрывается: она правит минуту прежних суток.
   */
  const lastToday = useRef(today);
  useEffect(() => {
    if (lastToday.current === today) return;
    lastToday.current = today;
    setEditDay(today);
    setEditing(null);
  }, [today]);

  const level = useMemo(() => currentBatteryLevel(journal, now), [journal, now]);
  const todayStats = useMemo(
    () => computeBatteryStats(journal, [today], now),
    [journal, today, now],
  );

  const dayShifts = journal.battery[editDay] ?? [];
  const carried = useMemo(() => levelBefore(journal, editDay), [journal, editDay]);
  /*
   * Хвост последней отметки: у прошедших суток он до полуночи, у сегодняшних —
   * до «сейчас». Иначе сегодняшнее состояние показывало бы длительность авансом,
   * до конца ещё не прожитого дня.
   */
  const dayEnd = editDay === today ? minuteOfDay(now) : MINUTES_IN_DAY;
  const defaultMinute = editDay === today ? minuteOfDay(now) : 12 * 60;

  const theme = level ? batteryTheme(level) : null;

  return (
    <>
      <header className="header">
        <h1 className="header__title">{t('charge.title')}</h1>
        <div className="header__actions">
          <HeaderBattery />
        </div>
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
                    pick(option);
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
          <span>{t('charge.editTitle')}</span>
        </div>

        <p className="charge__note">{t('charge.editNote')}</p>

        <DayPicker
          value={editDay}
          hasEntries={(day) => (journal.battery[day]?.length ?? 0) > 0}
          onChange={setEditDay}
        />

        {carried !== null && (
          <p className="charge__carried">
            {t('charge.carried', { title: batteryTitle(carried).toLowerCase() })}
          </p>
        )}

        {dayShifts.length === 0 ? (
          <p className="charge__note">{t('charge.dayEmpty')}</p>
        ) : (
          <ul className="bshifts">
            {dayShifts.map((shift, index) => {
              const optionTheme = batteryTheme(shift[1]);
              const next = dayShifts[index + 1]?.[0] ?? dayEnd;
              const minutes = Math.max(0, next - shift[0]);
              return (
                <li key={shift[0]}>
                  <button
                    className="bshifts__row press"
                    type="button"
                    style={{ '--accent': optionTheme.hex } as React.CSSProperties}
                    onClick={() => setEditing({ at: shift[0], minute: shift[0], level: shift[1] })}
                  >
                    <span className="bshifts__time">{formatTime(shift[0])}</span>
                    <span className="bshifts__dot" aria-hidden="true" />
                    <span className="bshifts__title">{batteryTitle(shift[1])}</span>
                    <span className="bshifts__len">
                      {index === dayShifts.length - 1 && editDay === today
                        ? t('charge.untilNow')
                        : formatMinutes(minutes)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <button
          className="btn press charge__wallpaper"
          type="button"
          onClick={() => setEditing({ minute: defaultMinute, level: level ?? 3 })}
        >
          {t('charge.shiftAdd')}
        </button>

        {/* Пояснения под заголовком нет намеренно: заголовок зовёт сделать, а
            кнопка под ним это и делает. Объяснение, почему у мини-приложения не
            бывает системного виджета, отвечало на вопрос, которого никто не
            задавал, и стояло ровно между зовом и действием. */}
        <div className="divider-label">
          <span>{t('charge.wallpaperTitle')}</span>
        </div>

        <button className="btn press charge__wallpaper" type="button" onClick={() => setWallpaperOpen(true)}>
          {t('charge.wallpaperAction')}
        </button>
      </div>

      <WallpaperSheet
        open={wallpaperOpen}
        initialLevel={level ?? 3}
        onClose={() => setWallpaperOpen(false)}
      />

      <BatteryShiftSheet
        shift={editing}
        dayLabel={editDay === today ? t('charge.todayTitle') : formatDayShort(editDay)}
        // Предел только у сегодняшнего дня: в прошедших сутках прошли все минуты.
        maxMinute={editDay === today ? minuteOfDay(now) : undefined}
        onClose={() => setEditing(null)}
        onSave={(minute, option) => {
          actions.setBatteryAt(editDay, minute, option, editing?.at);
          setEditing(null);
        }}
        onDelete={() => {
          if (editing?.at !== undefined) actions.removeBatteryShift(editDay, editing.at);
          setEditing(null);
        }}
      />
    </>
  );
}
