/**
 * Одна точка входа для смены заряда — и вопрос «что съело энергию» при переходе
 * на «на нуле».
 *
 * Раньше вопрос жил внутри экрана «Заряд», поэтому батарейка в шапке меняла
 * состояние молча: тот же переход на «на нуле» из шапки статистику причин не
 * пополнял. Теперь и шапка, и список на экране заряда вызывают один и тот же
 * pick, а шторка с вопросом одна на всё приложение.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { DrainSheet } from './DrainSheet';
import { currentBatteryLevel } from '../domain/stats';
import type { BatteryLevel } from '../domain/types';
import { useStore } from '../store/useStore';

type PickBattery = (level: BatteryLevel) => void;

const PickContext = createContext<PickBattery | null>(null);

export function BatteryPromptProvider({ children }: { children: ReactNode }): JSX.Element {
  const { settings, journal, actions } = useStore();
  const [asking, setAsking] = useState(false);

  const level = useMemo(() => currentBatteryLevel(journal), [journal]);

  const pick = useCallback<PickBattery>(
    (next) => {
      // Повтор того же состояния — не переход: ни записи, ни вопроса. Store
      // отбрасывает такую отметку сам, а вопрос без перехода был бы ложным.
      if (next === level) return;
      actions.setBattery(next);
      // Спрашиваем только на переходе «на нуле» и только если есть из чего
      // выбирать — иначе вопрос превращается в пустую модалку.
      if (next === 1 && settings.priorities.length > 0) setAsking(true);
    },
    [level, actions, settings.priorities.length],
  );

  return (
    <PickContext.Provider value={pick}>
      {children}
      <DrainSheet
        open={asking}
        priorities={settings.priorities}
        onAnswer={(drainedBy) => {
          actions.setDrain(drainedBy);
          setAsking(false);
        }}
        onSkip={() => setAsking(false)}
      />
    </PickContext.Provider>
  );
}

export function usePickBattery(): PickBattery {
  const pick = useContext(PickContext);
  if (!pick) throw new Error('usePickBattery вызван вне BatteryPromptProvider');
  return pick;
}
