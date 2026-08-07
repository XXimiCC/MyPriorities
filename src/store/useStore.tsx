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
  modulesOf,
  type BatteryLevel,
  type BatteryShift,
  type ClicksMap,
  type DayKey,
  type Journal,
  type Modules,
  type Priority,
  type Settings,
} from '../domain/types';
import { MAX_SKILLS, emptySkills, type Skill, type SkillsState } from '../skills/types';
import { stripAuto } from '../achievements/evaluate';
import {
  clearEverything,
  clearHistory,
  emptyJournal,
  emptySettings,
  exportSnapshot,
  foldExpiredMonths,
  loadAwards,
  loadJournal,
  loadSettings,
  loadSkillClicks,
  loadSkills,
  materialize,
  monthsToLoad,
  newShortId,
  parseSnapshot,
  pruneOldMonths,
  readLocalOnly,
  saveAwards,
  saveBatteryMonth,
  saveClicksMonth,
  saveSettings,
  saveSkills,
  saveSkillsMonth,
  writeAll,
  type AwardMap,
  type SnapshotContents,
} from './persistence';
import { MOCK_MODE, buildMockData } from './mock';

const FLUSH_DELAY_MS = 700;

/** Заведомо больше предела одного вызова к облаку, чтобы не срабатывать раньше него. */
const HYDRATE_DEADLINE_MS = 9000;

interface State {
  ready: boolean;
  settings: Settings;
  journal: Journal;
  skills: SkillsState;
  skillClicks: ClicksMap;
  awards: AwardMap;
  /** Только что открытые достижения — для всплывашки. В хранилище не едет. */
  fresh: string[];
  /**
   * Месяцы навыков прочитаны. Пока false, писать их запрещено: иначе включение
   * модуля тумблером записало бы пустую карту поверх облачной истории.
   */
  skillsLoaded: boolean;
}

type Hydration = Omit<State, 'ready' | 'fresh'>;

type Action =
  | ({ type: 'hydrate' } & Hydration)
  | { type: 'blocks'; day: DayKey; priorityId: string; delta: number }
  | { type: 'battery'; day: DayKey; minute: number; level: BatteryLevel }
  | { type: 'drain'; day: DayKey; drainedBy: string }
  | { type: 'settings'; settings: Settings }
  | { type: 'journal'; journal: Journal }
  | { type: 'skills'; skills: SkillsState }
  | { type: 'skill-blocks'; day: DayKey; skillId: string; delta: number }
  | { type: 'skill-journal'; skillClicks: ClicksMap; skillsLoaded: boolean }
  | { type: 'awards'; awards: AwardMap; fresh: string[] }
  | { type: 'dismiss-fresh' };

/** Прибавляет блок в карту кликов. Форма общая у приоритетов и навыков. */
function bump(clicks: ClicksMap, day: DayKey, id: string, delta: number): ClicksMap {
  const entry = clicks[day] ?? {};
  const next = Math.max(0, (entry[id] ?? 0) + delta);
  const updatedDay = { ...entry };
  if (next > 0) updatedDay[id] = next;
  else delete updatedDay[id];

  const out = { ...clicks };
  if (Object.keys(updatedDay).length > 0) out[day] = updatedDay;
  else delete out[day];
  return out;
}

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'hydrate':
      return {
        ready: true,
        fresh: [],
        settings: action.settings,
        journal: action.journal,
        skills: action.skills,
        skillClicks: action.skillClicks,
        awards: action.awards,
        skillsLoaded: action.skillsLoaded,
      };

    case 'blocks': {
      const clicks = bump(state.journal.clicks, action.day, action.priorityId, action.delta);
      return { ...state, journal: { ...state.journal, clicks } };
    }

    case 'skill-blocks':
      return {
        ...state,
        skillClicks: bump(state.skillClicks, action.day, action.skillId, action.delta),
      };

    case 'skills':
      return { ...state, skills: action.skills };

    case 'skill-journal':
      return { ...state, skillClicks: action.skillClicks, skillsLoaded: action.skillsLoaded };

    case 'awards':
      return { ...state, awards: action.awards, fresh: action.fresh };

    case 'dismiss-fresh':
      return state.fresh.length === 0 ? state : { ...state, fresh: [] };

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

    case 'drain': {
      // Ответ приписывается последнему переходу дня — тому самому, который
      // только что перевёл заряд на «на нуле» и вызвал вопрос.
      const shifts = state.journal.battery[action.day];
      const last = shifts?.[shifts.length - 1];
      if (!shifts || !last) return state;

      const updated: BatteryShift[] = [
        ...shifts.slice(0, -1),
        [last[0], last[1], action.drainedBy],
      ];
      return {
        ...state,
        journal: { ...state.journal, battery: { ...state.journal.battery, [action.day]: updated } },
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
  /** day по умолчанию — сегодня; передаётся явно только при заполнении пропусков. */
  addBlock(priorityId: string, day?: DayKey): void;
  removeBlock(priorityId: string, day?: DayKey): void;
  setBattery(level: BatteryLevel): void;
  /** Ответ на вопрос, что посадило заряд. Пустая строка — «не знаю». */
  setDrain(drainedBy: string): void;
  reorder(priorities: Priority[]): void;
  addPriority(title: string): Priority | undefined;
  updatePriority(id: string, patch: Partial<Pick<Priority, 'title' | 'colorId'>>): void;
  deletePriority(id: string): void;
  applyPreset(presetId: string): void;
  setBlockMinutes(minutes: number): void;

  /** Включает или выключает модуль. Включение навыков ждёт догрузки их истории. */
  setModule(id: keyof Modules, on: boolean): Promise<void>;

  addSkill(input: {
    title: string;
    baseHours?: number;
    colorId?: number;
    startedOn?: DayKey;
  }): Skill | undefined;
  updateSkill(
    id: string,
    patch: Partial<Pick<Skill, 'title' | 'colorId' | 'baseMinutes' | 'startedOn'>>,
  ): void;
  /** undefined снимает привязку. Приоритет отбирается у навыка, который держал его раньше. */
  linkSkill(skillId: string, priorityId: string | undefined): void;
  deleteSkill(id: string): void;
  reorderSkills(skills: Skill[]): void;
  addSkillBlock(skillId: string, day?: DayKey): void;
  removeSkillBlock(skillId: string, day?: DayKey): void;

  /** Отметить достижение: вручную или за действие в приложении. */
  award(id: string): void;
  unaward(id: string): void;
  /** Результат автоматической проверки. Ничего не делает, если карта не изменилась. */
  applyAwards(awards: AwardMap, fresh: string[]): void;
  dismissFresh(): void;

  /** Стирает клики, заряд и часы навыков; списки и отметки о жизни остаются. */
  resetHistory(): Promise<void>;
  /** Стирает всё и возвращает к выбору набора. */
  resetEverything(): Promise<void>;
  /** JSON со всеми данными — забрать копию до сброса. */
  exportData(): string;
  /** Восстановление из такой копии. Бросает, если файл не тот или повреждён. */
  importData(json: string): Promise<SnapshotContents>;
}

interface StoreValue extends State {
  today: DayKey;
  actions: StoreActions;
}

const StoreContext = createContext<StoreValue | null>(null);

const initialState: State = {
  ready: false,
  settings: emptySettings(),
  journal: emptyJournal(),
  skills: emptySkills(),
  skillClicks: {},
  awards: {},
  fresh: [],
  skillsLoaded: false,
};

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reduce, initialState);

  // Свежий снимок для флаша: он живёт вне рендера и не должен ловить устаревшее замыкание.
  const latest = useRef(state);
  latest.current = state;

  const dirtyClicks = useRef(new Set<string>());
  const dirtyBattery = useRef(new Set<string>());
  const dirtySkillClicks = useRef(new Set<string>());
  const dirtySettings = useRef(false);
  const flushTimer = useRef<number | undefined>(undefined);

  const flush = useCallback(async () => {
    if (MOCK_MODE) return;
    window.clearTimeout(flushTimer.current);
    flushTimer.current = undefined;

    const months = {
      clicks: [...dirtyClicks.current],
      battery: [...dirtyBattery.current],
      skills: [...dirtySkillClicks.current],
    };
    const settingsDirty = dirtySettings.current;
    dirtyClicks.current.clear();
    dirtyBattery.current.clear();
    dirtySkillClicks.current.clear();
    dirtySettings.current = false;

    const { settings, journal, skillClicks, skillsLoaded } = latest.current;
    try {
      if (settingsDirty) await saveSettings(settings);
      for (const month of months.clicks) await saveClicksMonth(journal, month);
      for (const month of months.battery) await saveBatteryMonth(journal, month);
      // Пока история навыков не прочитана, в памяти пусто, и запись месяца
      // затёрла бы облачные данные. Проверка страхует любой путь, а не только тумблер.
      if (skillsLoaded) {
        for (const month of months.skills) await saveSkillsMonth(skillClicks, month);
      } else if (months.skills.length > 0) {
        console.warn('[store] история навыков не прочитана, запись месяцев отложена');
        months.skills.forEach((m) => dirtySkillClicks.current.add(m));
      }
    } catch (error) {
      // Возвращаем метки, чтобы следующая попытка дописала то же самое.
      console.warn('[store] запись не удалась, повторим позже', error);
      months.clicks.forEach((m) => dirtyClicks.current.add(m));
      months.battery.forEach((m) => dirtyBattery.current.add(m));
      months.skills.forEach((m) => dirtySkillClicks.current.add(m));
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
  /** Каталог навыков и достижения пишутся так же немедленно и по той же причине. */
  const pendingCatalogs = useRef<Promise<void>>(Promise.resolve());

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

  const writeSkills = useCallback((skills: SkillsState) => {
    if (MOCK_MODE) return;
    pendingCatalogs.current = pendingCatalogs.current
      .then(() => saveSkills(skills))
      .catch((error) => console.warn('[store] каталог навыков не записался', error));
  }, []);

  const writeAwards = useCallback((awards: AwardMap) => {
    if (MOCK_MODE) return;
    pendingCatalogs.current = pendingCatalogs.current
      .then(() => saveAwards(awards))
      .catch((error) => console.warn('[store] достижения не записались', error));
  }, []);

  /** Отменяет всё, что ещё не записано. Нужно перед сбросом, чтобы стёртое не вернулось. */
  const dropPendingWrites = useCallback(async () => {
    window.clearTimeout(flushTimer.current);
    flushTimer.current = undefined;
    dirtyClicks.current.clear();
    dirtyBattery.current.clear();
    dirtySkillClicks.current.clear();
    dirtySettings.current = false;
    // Незавершённая запись иначе доедет уже после очистки и воскресит стёртое.
    await pendingSettings.current;
    await pendingCatalogs.current;
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

  const markSkillClicks = useCallback(
    (day: DayKey) => {
      dirtySkillClicks.current.add(monthKey(day));
      scheduleFlush();
    },
    [scheduleFlush],
  );


  // --- Гидратация ---
  useEffect(() => {
    let cancelled = false;
    let settled = false;

    const finish = (loaded: Partial<Hydration> & { settings: Settings | undefined }): void => {
      if (cancelled || settled) return;
      settled = true;
      dispatch({
        type: 'hydrate',
        settings: loaded.settings ?? emptySettings(),
        journal: loaded.journal ?? emptyJournal(),
        skills: loaded.skills ?? emptySkills(),
        skillClicks: loaded.skillClicks ?? {},
        awards: loaded.awards ?? {},
        skillsLoaded: loaded.skillsLoaded ?? false,
      });
    };

    /**
     * Последний рубеж против бесконечного спиннера. Отдельные вызовы к облаку
     * уже ограничены по времени, но если зависнет что-то ещё, приложение всё
     * равно обязано показаться: пустой экран без объяснений хуже, чем экран
     * с локальными данными и предупреждением в настройках.
     */
    const deadline = window.setTimeout(() => {
      if (settled) return;
      console.warn('[store] загрузка затянулась, показываем то, что успели прочитать');
      void readLocalOnly().then((local) => finish({ ...local, skillsLoaded: true }));
    }, HYDRATE_DEADLINE_MS);

    void (async () => {
      if (MOCK_MODE) {
        finish({ ...buildMockData(), skillsLoaded: true });
        window.clearTimeout(deadline);
        return;
      }

      let settings: Settings | undefined;
      let journal: Journal = emptyJournal();
      let skills: SkillsState = emptySkills();
      let skillClicks: ClicksMap = {};
      let awards: AwardMap = {};
      let skillsLoaded = false;

      try {
        settings = await loadSettings();
        /*
         * Каталог навыков и достижения читаются всегда, даже при выключенном
         * модуле: иначе выключенный и снова включённый модуль показал бы пустой
         * список, а первая же запись стёрла бы облачные данные. Гейтится только
         * история по месяцам — она и стоит запросов.
         */
        skills = await loadSkills();
        awards = await loadAwards();
        journal = await loadJournal(monthsToLoad());

        if (modulesOf(settings ?? emptySettings()).skills) {
          skillClicks = await loadSkillClicks(monthsToLoad());
          skillsLoaded = true;
        }
      } catch (error) {
        console.warn('[store] загрузка не удалась, стартуем с пустого состояния', error);
      }
      window.clearTimeout(deadline);
      if (cancelled) return;

      finish({ settings, journal, skills, skillClicks, awards, skillsLoaded });

      // Свёртка строго до уборки: она читает те самые месяцы, что уборка удалит.
      void (async () => {
        const folded = await foldExpiredMonths(skills);
        if (!cancelled && folded) {
          dispatch({ type: 'skills', skills: folded });
          writeSkills(folded);
        }
        await pruneOldMonths();
      })();
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(deadline);
    };
  }, [writeSkills]);

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

    const commitSkills = (skills: SkillsState): void => {
      dispatch({ type: 'skills', skills });
      writeSkills(skills);
    };

    const commitAwards = (awards: AwardMap, fresh: string[] = []): void => {
      dispatch({ type: 'awards', awards, fresh });
      writeAwards(awards);
    };

    const patchSkill = (id: string, patch: (skill: Skill) => Skill): void => {
      const current = latest.current.skills;
      commitSkills({
        ...current,
        skills: current.skills.map((skill) => (skill.id === id ? patch(skill) : skill)),
      });
    };

    return {
      addBlock(priorityId, day = todayKey()) {
        dispatch({ type: 'blocks', day, priorityId, delta: 1 });
        markClicks(day);
      },

      removeBlock(priorityId, day = todayKey()) {
        dispatch({ type: 'blocks', day, priorityId, delta: -1 });
        markClicks(day);
      },

      setBattery(level) {
        const now = new Date();
        const day = todayKey(now);
        dispatch({ type: 'battery', day, minute: minuteOfDay(now), level });
        markBattery(day);
      },

      setDrain(drainedBy) {
        const day = todayKey();
        dispatch({ type: 'drain', day, drainedBy });
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
          id: newShortId(taken),
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

        // blockMinutes и modules переносятся: цена блока и набор включённых
        // модулей — личные настройки, а не часть сборника приоритетов.
        commitSettings({
          version: 1,
          priorities,
          archived,
          presetId,
          onboarded: true,
          blockMinutes: current.blockMinutes,
          modules: current.modules,
        });
      },

      setBlockMinutes(minutes) {
        if (!Number.isFinite(minutes) || minutes <= 0) return;
        commitSettings({ ...latest.current.settings, blockMinutes: Math.round(minutes) });
      },

      async setModule(id, on) {
        /*
         * История навыков доносится ДО того, как включится флаг: иначе вкладка
         * появится раньше данных, и клик, сделанный в эту щель, потеряется —
         * пришедшая следом карта заменит собой оптимистичную запись.
         */
        if (id === 'skills' && on && !latest.current.skillsLoaded && !MOCK_MODE) {
          try {
            const clicks = await loadSkillClicks(monthsToLoad());
            dispatch({ type: 'skill-journal', skillClicks: clicks, skillsLoaded: true });
          } catch (error) {
            console.warn('[store] история навыков не догрузилась', error);
          }
        }

        const current = latest.current.settings;
        commitSettings({ ...current, modules: { ...modulesOf(current), [id]: on } });
      },

      addSkill({ title, baseHours, colorId, startedOn }) {
        const current = latest.current.skills;
        if (current.skills.length >= MAX_SKILLS) return undefined;
        const trimmed = title.trim();
        if (!trimmed) return undefined;

        // Навык с таким названием мог быть удалён раньше — возвращаем его с часами.
        const revived = current.archived.find(
          (s) => s.title.trim().toLowerCase() === trimmed.toLowerCase(),
        );
        const taken = new Set([
          ...current.skills.map((s) => s.id),
          ...current.archived.map((s) => s.id),
        ]);
        const hours = Number(baseHours);
        const skill: Skill = revived ?? {
          id: newShortId(taken),
          title: trimmed,
          // Цвет приходит из формы; без него берётся первый незанятый.
          colorId: Number.isFinite(colorId) && colorId! >= 0
            ? colorId!
            : nextFreeColorId(current.skills.map((s) => s.colorId)),
          baseMinutes: Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : 0,
          carryBlocks: 0,
          ...(startedOn ? { startedOn } : {}),
        };

        commitSkills({
          ...current,
          skills: [...current.skills, skill],
          archived: current.archived.filter((s) => s.id !== skill.id),
        });
        return skill;
      },

      updateSkill(id, patch) {
        patchSkill(id, (skill) => ({
          ...skill,
          ...(patch.title !== undefined ? { title: patch.title.trim() || skill.title } : {}),
          ...(patch.colorId !== undefined ? { colorId: patch.colorId } : {}),
          ...(patch.baseMinutes !== undefined
            ? { baseMinutes: Math.max(0, Math.round(patch.baseMinutes)) }
            : {}),
          ...(patch.startedOn !== undefined ? { startedOn: patch.startedOn } : {}),
        }));
      },

      linkSkill(skillId, priorityId) {
        const current = latest.current.skills;
        commitSkills({
          ...current,
          skills: current.skills.map((skill) => {
            if (skill.id === skillId) {
              const { linkedPriorityId: _old, ...rest } = skill;
              return priorityId ? { ...rest, linkedPriorityId: priorityId } : rest;
            }
            // Один приоритет кормит только один навык: иначе одни и те же часы
            // засчитались бы дважды. Прежняя привязка снимается молча — о ней
            // предупредили в диалоге до вызова.
            if (priorityId && skill.linkedPriorityId === priorityId) {
              const { linkedPriorityId: _drop, ...rest } = skill;
              return rest;
            }
            return skill;
          }),
        });
      },

      deleteSkill(id) {
        const current = latest.current.skills;
        const removed = current.skills.find((s) => s.id === id);
        if (!removed) return;

        // В архив, а не в небытие: накопленные часы вернутся, если завести
        // навык с тем же названием. Привязку снимаем — архивный ничего не считает.
        const { linkedPriorityId: _drop, ...archived } = removed;
        commitSkills({
          ...current,
          skills: current.skills.filter((s) => s.id !== id),
          archived: [...current.archived.filter((s) => s.id !== id), archived],
        });
      },

      reorderSkills(skills) {
        commitSkills({ ...latest.current.skills, skills });
      },

      addSkillBlock(skillId, day = todayKey()) {
        dispatch({ type: 'skill-blocks', day, skillId, delta: 1 });
        markSkillClicks(day);
      },

      removeSkillBlock(skillId, day = todayKey()) {
        dispatch({ type: 'skill-blocks', day, skillId, delta: -1 });
        markSkillClicks(day);
      },

      award(id) {
        const current = latest.current.awards;
        if (current[id] !== undefined) return;
        commitAwards({ ...current, [id]: todayKey() });
      },

      unaward(id) {
        const current = latest.current.awards;
        if (current[id] === undefined) return;
        const { [id]: _removed, ...rest } = current;
        commitAwards(rest);
      },

      applyAwards(awards, fresh) {
        if (awards === latest.current.awards) return;
        commitAwards(awards, fresh);
      },

      dismissFresh() {
        dispatch({ type: 'dismiss-fresh' });
      },

      async resetHistory() {
        // Сначала гасим отложенную запись: иначе таймер, взведённый последним
        // кликом, допишет только что стёртый месяц обратно.
        await dropPendingWrites();
        const current = latest.current;

        dispatch({ type: 'journal', journal: emptyJournal() });
        dispatch({ type: 'skill-journal', skillClicks: {}, skillsLoaded: current.skillsLoaded });

        /*
         * Навыки сохраняют то, что не выведено из кликов: стартовый капитал и
         * дату начала. carryBlocks обнуляется — это свёрнутая история, которой
         * больше нет. Маркер свёртки тоже, иначе он запретил бы сворачивать заново.
         */
        const skills: SkillsState = {
          skills: current.skills.skills.map((skill) => ({ ...skill, carryBlocks: 0 })),
          archived: current.skills.archived.map((skill) => ({ ...skill, carryBlocks: 0 })),
        };
        commitSkills(skills);

        // Автоматические достижения снимаются: данных, из которых они выведены,
        // больше нет. Отметки о жизни и ритуалы остаются — это факты, а не выводы.
        commitAwards(stripAuto(current.awards));

        await clearHistory();
      },

      async resetEverything() {
        await dropPendingWrites();
        dispatch({
          type: 'hydrate',
          settings: emptySettings(),
          journal: emptyJournal(),
          skills: emptySkills(),
          skillClicks: {},
          awards: {},
          skillsLoaded: true,
        });
        await clearEverything();
      },

      exportData() {
        const { settings, journal, skills, skillClicks, awards } = latest.current;
        return exportSnapshot({ settings, journal, skills, skillClicks, awards });
      },

      async importData(json) {
        const restored = parseSnapshot(json);
        await dropPendingWrites();
        dispatch({ type: 'hydrate', ...restored, skillsLoaded: true });
        // Старые месяцы сносятся целиком: иначе то, чего нет в копии, осталось бы в облаке.
        await clearHistory();
        await writeAll(restored);
        return restored;
      },
    };
  }, [
    markClicks,
    markBattery,
    markSkillClicks,
    writeSettings,
    writeSkills,
    writeAwards,
    dropPendingWrites,
  ]);

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
