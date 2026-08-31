/**
 * Утренний вопрос про ночь.
 *
 * Заряд переходит через полночь: последняя вечерняя отметка действует до
 * следующей, и ночь, которую никто не отметил, засчитывается тем состоянием, в
 * котором человек лёг. Починка была ручной — экран «Заряд», лента дней,
 * «Добавить отметку», и столько же утром. Здесь то же самое одним касанием.
 *
 * Спрашиваем факт, а не даём совет: «ночь не отмечена» — да, «не забывай
 * отмечать сон» — нет. И ничего не пишем молча: отказ закрывает шторку без
 * единой записи, а вернётся она не раньше завтрашнего утра.
 *
 * Правило показа живёт в `domain/battery.ts` и проверяется тестом; здесь —
 * только память устройства, поле и две отметки.
 */

import { useEffect, useMemo, useState } from 'react';

import { BatteryChoice } from './BatterySheet';
import { Sheet } from './Sheet';
import { readNightMemory, writeNightMemory } from './nightMemory';
import { useNow } from './useNow';
import { DEMO_MODE } from '../demo/mode';
import {
  formatTime,
  nightAsk,
  nightBedtime,
  parseTime,
  type NightAsk,
  type NightMemory,
} from '../domain/battery';
import { todayKey } from '../domain/date';
import { batteryTheme } from '../domain/palette';
import type { BatteryLevel, DayKey } from '../domain/types';
import { t } from '../i18n';
import { useStore } from '../store/useStore';
import './NightSheet.css';

/** Куда встанет отметка «Заряжаюсь»: сутки журнала и минута от их полуночи. */
type Bedtime = { day: DayKey; minute: number };

export function NightSheet(): JSX.Element | null {
  const { ready, journal, actions } = useStore();
  const now = useNow();

  /*
   * Память устройства поднимается один раз и дальше живёт в состоянии. До
   * ответа хранилища шторки нет: иначе вчерашний отказ успевал бы мигнуть
   * вопросом, а «не чаще раза в сутки» держится именно на этой записи.
   *
   * В демо не спрашиваем вовсе — синтетика чужой ночи не имеет.
   */
  const [memory, setMemory] = useState<NightMemory | null>(null);
  useEffect(() => {
    if (DEMO_MODE) return;
    void readNightMemory().then(setMemory);
  }, []);

  const ask = useMemo(
    () => (ready && memory ? nightAsk(journal, memory, now) : null),
    [ready, memory, journal, now],
  );

  if (!ask) return null;

  /** Ответ этого устройства: и «сегодня уже спрашивали», и время для поля. */
  const remember = (bedtime?: number): void => {
    const next: NightMemory = { askedOn: todayKey(now), bedtime: bedtime ?? memory?.bedtime };
    setMemory(next);
    void writeNightMemory(next);
  };

  // Отклик даёт сама плитка при нажатии — второго на то же касание не нужно.
  const save = (bedtime: Bedtime, level: BatteryLevel): void => {
    /*
     * Две отметки, а не одна. «Заряжаюсь» чинит ночь, но без второй весь день
     * до следующего касания считался бы сном — и вместо одной неверной полосы
     * получилась бы другая.
     */
    actions.setBatteryAt(bedtime.day, bedtime.minute, 4);
    actions.setBattery(level);
    remember(bedtime.minute);
  };

  return (
    <Sheet open title={t('charge.nightTitle')} onClose={() => remember()}>
      <NightForm ask={ask} now={now} onSave={save} />
    </Sheet>
  );
}

function NightForm({
  ask,
  now,
  onSave,
}: {
  ask: NightAsk;
  now: Date;
  onSave(bedtime: Bedtime, level: BatteryLevel): void;
}): JSX.Element {
  const [time, setTime] = useState(() => formatTime(ask.bedtime));

  const minute = parseTime(time);
  /*
   * Набранное остаётся в поле, даже когда оно не годится: пока печатают
   * «01:30», строка успевает побывать и «0», и «01:00». Поэтому заперт выбор
   * состояния, а под полем написано почему — тот же приём, что в шторке правки.
   */
  const bedtime = minute === undefined ? undefined : nightBedtime(minute, ask.last, now);

  return (
    <div className="night" style={{ '--accent': batteryTheme(4).hex } as React.CSSProperties}>
      <p className="night__note">{t('charge.nightNote')}</p>

      <label className="night__time">
        <span>{t('charge.nightBedtime')}</span>
        {/* Границы поля перескакивают полночь: окно начинается вчера вечером и
            кончается сегодняшним «сейчас», поэтому min бывает больше max. */}
        <input
          type="time"
          value={time}
          min={formatTime(ask.from)}
          max={formatTime(ask.to)}
          onChange={(event) => setTime(event.target.value)}
        />
      </label>

      <p className={`night__hint${bedtime ? '' : ' night__hint--stop'}`}>
        {t(bedtime ? 'charge.nightHint' : 'charge.nightEarly')}
      </p>

      <div className="divider-label">
        <span>{t('charge.nightPick')}</span>
      </div>

      <BatteryChoice
        current={null}
        disabled={!bedtime}
        onPick={(level) => {
          if (bedtime) onSave(bedtime, level);
        }}
      />
    </div>
  );
}
