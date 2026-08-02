/**
 * Единый стор приложения.
 *
 * Запись оптимистична: состояние меняется сразу, а в хранилище улетает
 * отложенно, пачкой по «грязным» месяцам. Иначе каждый тап по «+» ждал бы
 * ответа CloudStorage, а это заметная задержка на мобильной сети.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';

import { minuteOfDay, monthKey, todayKey } from '../domain/date';
import { nextFreeColorId } from '../domain/palette';
import { PRESETS } from '../domain/presets';
import {
  MAX_PRIORITIES,
  MIN_PRIORITIES,
  type BatteryLevel,
  type DayKey,
  type Journal,
  type Priority,
  type Settings,
} from '../domain/types';
import {
  clearEverything,
  clearHistory,
  emptyJournal,
  emptySettings,
  exportSnapshot,
  loadJournal,
  loadSettings,
  materialize,
  monthsToLoad,
  newPriorityId,
  parseSnapshot,
  pruneOldMonths,
  saveBatteryMonth,
  saveClicksMonth,
  saveSettings,
  writeAll,
} from './persistence';
import { MOCK_MODE, buildMockData } from './mock';

const FLUSH_DELAY_MS = 700;

interface State {
  ready: boolean;
  settings: Settings;
  journal: Journal;
}

type Action =
  | { type: 'hydrate'; settings: Settings; journal: Journal }
  | { type: 'blocks'; day: DayKey; priorityId: string; delta: number }
  | { type: 'battery'; day: DayKey; minute: number; level: BatteryLevel }
  | { type: 'settings'; settings: Settings }
  | { type: 'journal'; journal: Journal };

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'hydrate':
      return { ready: true, settings: action.settings, journal: action.journal };

    case 'blocks': {
      const day = state.journal.clicks[action.day] ?? {};
      const next = Math.max(0, (day[action.priorityId] ?? 0) + action.delta);
      const updatedDay = { ...day };
      if (next > 0) updatedDay[action.priorityId] = next;
      else delete updatedDay[action.priorityId];

      const clicks = { ...state.journal.clicks };
      if (Object.keys(updatedDay).length > 0) clicks[action.day] = updatedDay;
      else delete clicks[action.day];

      return { ...state, journal: { ...state.journal, clicks } };
    }

    case 'battery': {
      const existing = state.journal.battery[action.day] ?? [];
      const last = existing[existing.length - 1];
      // Повтор того же уровня ничего не меняет — лишняя запись только раздувает месяц.
      if (last && last[1] === action.level && last[0] <= action.minute) return state;

      const withoutSameMinute = existing.filter((shift) => shift[0] !== action.minute);
      const shifts = [...withoutSameMinute, [action.minute, action.level] as [number, BatteryLevel]].sort(
        (a, b) => a[0] - b[0],
      );
      return {
        ...state,
        journal: { ...state.journal, battery: { ...state.journal.battery, [action.day]: shifts } },
      };
    }

    case 'settings':
      return { ...state, settings: action.settings };

    case 'journal':
      return { ...state, journal: action.journal };

    default:
      return state;
  }
}

export interface StoreActions {
  addBlock(priorityId: string): void;
  removeBlock(priorityId: string): void;
  setBattery(level: BatteryLevel): void;
  reorder(priorities: Priority[]): void;
  addPriority(title: string): Priority | undefined;
  updatePriority(id: string, patch: Partial<Pick<Priority, 'title' | 'colorId'>>): void;
  deletePriority(id: string): void;
  applyPreset(presetId: string): void;
  setBlockMinutes(minutes: number): void;
  /** Стирает клики и заряд, приоритеты остаются. */
  resetHistory(): Promise<void>;
  /** Стирает всё и возвращает к выбору набора. */
  resetEverything(): Promise<void>;
  /** JSON со всеми данными — забрать копию до сброса. */
  exportData(): string;
  /** Восстановление из такой копии. Бросает, если файл не тот или повреждён. */
  importData(json: string): Promise<{ settings: Settings; journal: Journal }>;
}

interface StoreValue extends State {
  today: DayKey;
  actions: StoreActions;
}

const StoreContext = createContext<StoreValue | null>(null);

const initialState: State = { ready: false, settings: emptySettings(), journal: emptyJournal() };

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reduce, initialState);

  // Свежий снимок для флаша: он живёт вне рендера и не должен ловить устаревшее замыкание.
  const latest = useRef(state);
  latest.current = state;

  const dirtyClicks = useRef(new Set<string>());
  const dirtyBattery = useRef(new Set<string>());
  const dirtySettings = useRef(false);
  const flushTimer = useRef<number | undefined>(undefined);

  const flush = useCallback(async () => {
    if (MOCK_MODE) return;
    window.clearTimeout(flushTimer.current);
    flushTimer.current = undefined;

    const months = { clicks: [...dirtyClicks.current], battery: [...dirtyBattery.current] };
    const settingsDirty = dirtySettings.current;
    dirtyClicks.current.clear();
    dirtyBattery.current.clear();
    dirtySettings.current = false;

    const { settings, journal } = latest.current;
    try {
      if (settingsDirty) await saveSettings(settings);
      for (const month of months.clicks) await saveClicksMonth(journal, month);
      for (const month of months.battery) await saveBatteryMonth(journal, month);
    } catch (error) {
      // Возвращаем метки, чтобы следующая попытка дописала то же самое.
      console.warn('[store] запись не удалась, повторим позже', error);
      months.clicks.forEach((m) => dirtyClicks.current.add(m));
      months.battery.forEach((m) => dirtyBattery.current.add(m));
      if (settingsDirty) dirtySettings.current = true;
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (MOCK_MODE) return;
    window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => void flush(), FLUSH_DELAY_MS);
  }, [flush]);

  /**
   * Настройки пишутся сразу, а не пачкой через паузу.
   *
   * Список приоритетов меняется редко (набор, добавление, переименование), зато
   * его потеря выглядит как «все данные пропали»: без ключа mp:s приложение
   * открывается онбордингом. Отложенная запись здесь ничего не экономила, но
   * давала окно, в котором закрытый мини-апп уносил изменение с собой.
   *
   * Значение приходит аргументом, а не берётся из latest: markSettings вызывается
   * сразу за dispatch, в том же такте, когда состояние ещё старое.
   */
  const pendingSettings = useRef<Promise<void>>(Promise.resolve());

  const writeSettings = useCallback(
    (settings: Settings) => {
      if (MOCK_MODE) return;
      pendingSettings.current = saveSettings(settings).catch((error) => {
        console.warn('[store] настройки не записались, повторим общим флашем', error);
        dirtySettings.current = true;
        scheduleFlush();
      });
    },
    [scheduleFlush],
  );

  /** Отменяет всё, что ещё не записано. Нужно перед сбросом, чтобы стёртое не вернулось. */
  const dropPendingWrites = useCallback(async () => {
    window.clearTimeout(flushTimer.current);
    flushTimer.current = undefined;
    dirtyClicks.current.clear();
    dirtyBattery.current.clear();
    dirtySettings.current = false;
    // Незавершённая запись настроек иначе доедет уже после очистки и воскресит их.
    await pendingSettings.current;
  }, []);

  const markClicks = useCallback(
    (day: DayKey) => {
      dirtyClicks.current.add(monthKey(day));
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const markBattery = useCallback(
    (day: DayKey) => {
      dirtyBattery.current.add(monthKey(day));
      scheduleFlush();
    },
    [scheduleFlush],
  );


  // --- Гидратация ---
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (MOCK_MODE) {
        const mock = buildMockData();
        if (!cancelled) dispatch({ type: 'hydrate', ...mock });
        return;
      }

      let settings: Settings | undefined;
      let journal: Journal = emptyJournal();
      try {
        settings = await loadSettings();
        journal = await loadJournal(monthsToLoad());
      } catch (error) {
        console.warn('[store] загрузка не удалась, стартуем с пустого состояния', error);
      }
      if (cancelled) return;

      dispatch({ type: 'hydrate', settings: settings ?? emptySettings(), journal });
      void pruneOldMonths();
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Сворачивание мини-аппа не даёт времени на отложенную запись — дожимаем немедленно.
  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', () => void flush());
    return () => {
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [flush]);

  const today = todayKey();

  const actions = useMemo<StoreActions>(() => {
    const commitSettings = (settings: Settings): void => {
      dispatch({ type: 'settings', settings });
      writeSettings(settings);
    };

    return {
      addBlock(priorityId) {
        const day = todayKey();
        dispatch({ type: 'blocks', day, priorityId, delta: 1 });
        markClicks(day);
      },

      removeBlock(priorityId) {
        const day = todayKey();
        dispatch({ type: 'blocks', day, priorityId, delta: -1 });
        markClicks(day);
      },

      setBattery(level) {
        const now = new Date();
        const day = todayKey(now);
        dispatch({ type: 'battery', day, minute: minuteOfDay(now), level });
        markBattery(day);
      },

      reorder(priorities) {
        commitSettings({ ...latest.current.settings, priorities });
      },

      addPriority(title) {
        const current = latest.current.settings;
        if (current.priorities.length >= MAX_PRIORITIES) return undefined;
        const trimmed = title.trim();
        if (!trimmed) return undefined;

        // Приоритет с таким названием мог быть удалён раньше — возвращаем его вместе с историей.
        const revived = current.archived.find(
          (p) => p.title.trim().toLowerCase() === trimmed.toLowerCase(),
        );
        const taken = new Set([
          ...current.priorities.map((p) => p.id),
          ...current.archived.map((p) => p.id),
        ]);
        const priority: Priority = revived ?? {
          id: newPriorityId(taken),
          title: trimmed,
          colorId: nextFreeColorId(current.priorities.map((p) => p.colorId)),
        };

        commitSettings({
          ...current,
          priorities: [...current.priorities, priority],
          archived: current.archived.filter((p) => p.id !== priority.id),
        });
        return priority;
      },

      updatePriority(id, patch) {
        const current = latest.current.settings;
        commitSettings({
          ...current,
          priorities: current.priorities.map((p) =>
            p.id === id
              ? { ...p, ...(patch.title !== undefined ? { title: patch.title.trim() || p.title } : {}), ...(patch.colorId !== undefined ? { colorId: patch.colorId } : {}) }
              : p,
          ),
        });
      },

      deletePriority(id) {
        const current = latest.current.settings;
        if (current.priorities.length <= MIN_PRIORITIES) return;
        const removed = current.priorities.find((p) => p.id === id);
        if (!removed) return;

        // В архив, а не в небытие: за прошлые недели у него есть время, и статистика
        // должна показывать его под нормальным названием, а не под голым id.
        commitSettings({
          ...current,
          priorities: current.priorities.filter((p) => p.id !== id),
          archived: [...current.archived.filter((p) => p.id !== id), removed],
        });
      },

      applyPreset(presetId) {
        const preset = PRESETS.find((p) => p.id === presetId);
        if (!preset) return;
        const current = latest.current.settings;
        const known = [...current.priorities, ...current.archived];
        const priorities = materialize(preset.priorities, known);

        const keptIds = new Set(priorities.map((p) => p.id));
        const archived = [
          ...current.archived.filter((p) => !keptIds.has(p.id)),
          ...current.priorities.filter((p) => !keptIds.has(p.id)),
        ];

        // blockMinutes переносится: цена блока — личная настройка, а не часть набора.
        commitSettings({
          version: 1,
          priorities,
          archived,
          presetId,
          onboarded: true,
          blockMinutes: current.blockMinutes,
        });
      },

      setBlockMinutes(minutes) {
        if (!Number.isFinite(minutes) || minutes <= 0) return;
        commitSettings({ ...latest.current.settings, blockMinutes: Math.round(minutes) });
      },

      async resetHistory() {
        // Сначала гасим отложенную запись: иначе таймер, взведённый последним
        // кликом, допишет только что стёртый месяц обратно.
        await dropPendingWrites();
        dispatch({ type: 'journal', journal: emptyJournal() });
        await clearHistory();
      },

      async resetEverything() {
        await dropPendingWrites();
        dispatch({ type: 'hydrate', settings: emptySettings(), journal: emptyJournal() });
        await clearEverything();
      },

      exportData() {
        const { settings, journal } = latest.current;
        return exportSnapshot(settings, journal);
      },

      async importData(json) {
        const restored = parseSnapshot(json);
        await dropPendingWrites();
        dispatch({ type: 'hydrate', ...restored });
        // Старые месяцы сносятся целиком: иначе то, чего нет в копии, осталось бы в облаке.
        await clearHistory();
        await writeAll(restored.settings, restored.journal);
        return restored;
      },
    };
  }, [markClicks, markBattery, writeSettings, dropPendingWrites]);

  const value = useMemo<StoreValue>(
    () => ({ ...state, today, actions }),
    [state, today, actions],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore вызван вне StoreProvider');
  return value;
}
