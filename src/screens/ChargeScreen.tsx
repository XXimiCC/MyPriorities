import { useMemo, useState } from 'react';

import { BatteryCaption, BatteryIcon } from '../components/BatteryIcon';
import { WallpaperSheet } from '../components/WallpaperSheet';
import { formatMinutes, formatPercent } from '../domain/date';
import { batteryTheme } from '../domain/palette';
import { computeBatteryStats, currentBatteryLevel, periodDays } from '../domain/stats';
import { BATTERY_LEVELS, PERIODS, type BatteryLevel } from '../domain/types';
import { useStore } from '../store/useStore';
import { haptics } from '../telegram/sdk';
import './ChargeScreen.css';

const TODAY = PERIODS.find((p) => p.id === 'today')!;

/** Что именно значит каждое состояние — иначе выбор превращается в гадание. */
const MEANING: Record<BatteryLevel, string> = {
  3: 'Есть силы на сложное. Беритесь за то, что требует головы.',
  2: 'Рабочее состояние. Тянете рутину, но не подвиги.',
  1: 'Ресурс на нуле. Всё, что сейчас делается, делается через силу.',
  4: 'Восстанавливаетесь: сон, тишина, прогулка, ничегонеделание.',
};

export function ChargeScreen(): JSX.Element {
  const { journal, actions } = useStore();
  const [wallpaperOpen, setWallpaperOpen] = useState(false);

  const level = useMemo(() => currentBatteryLevel(journal), [journal]);
  const todayStats = useMemo(
    () => computeBatteryStats(journal, periodDays(TODAY, journal)),
    [journal],
  );

  const theme = level ? batteryTheme(level) : null;

  return (
    <>
      <header className="header">
        <h1 className="header__title">Заряд</h1>
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
                  ? `Сегодня в этом состоянии — ${formatMinutes(todayStats.minutes[level])}`
                  : 'Отсчёт пошёл'}
              </p>
            </>
          ) : (
            <>
              <BatteryIcon level={2} width={168} dimmed />
              <p className="charge__meaning">
                Заряд ещё не отмечен. Выберите состояние — с этого момента приложение начнёт считать,
                сколько времени вы в нём проводите.
              </p>
            </>
          )}
        </div>

        <div className="divider-label">
          <span>Как вы сейчас</span>
        </div>

        <p className="charge__note">
          Это не про батарею телефона, а про ваш собственный ресурс. Отмечайте, когда состояние
          действительно изменилось: приложение считает время между переключениями, поэтому один тап
          утром описывает всё утро.
        </p>

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
                  }}
                >
                  <BatteryIcon level={option} width={48} dimmed={!active} glow={active} />
                  <span className="charge__option-text">
                    <b>{optionTheme.title}</b>
                    <small>{MEANING[option]}</small>
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
              <span>Сегодня</span>
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
                    title={`${batteryTheme(option).title}: ${formatPercent(share)}`}
                  />
                );
              })}
            </div>
            <p className="charge__note">
              Полная разбивка за неделю и месяц — на вкладке «Статистика».
            </p>
          </>
        )}

        <div className="divider-label">
          <span>Вынести на рабочий стол</span>
        </div>

        <p className="charge__note">
          Системного виджета у мини-приложений быть не может, поэтому заряд выносится картинкой:
          заставка с текущим состоянием под точное разрешение вашего экрана.
        </p>

        <button className="edit__add press charge__wallpaper" type="button" onClick={() => setWallpaperOpen(true)}>
          Сделать обои с зарядом
        </button>
      </div>

      <WallpaperSheet
        open={wallpaperOpen}
        initialLevel={level ?? 3}
        onClose={() => setWallpaperOpen(false)}
      />
    </>
  );
}
