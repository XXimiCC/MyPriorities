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
  useState,
  type ReactNode,
} from 'react';

import { minuteOfDay, monthKey, todayKey } from '../domain/date';
import { nextFreeColorId } from '../domain/palette';
import { PRESETS } from '../domain/presets';
import {
  MAX_PRIORITIES,
  MIN_PRIORITIES,
  emptyJournal,
  modulesOf,
  type BatteryLevel,
  type ClicksMap,
  type DayKey,
  type Journal,
  type Modules,
  type Priority,
  type Settings,
} from '../domain/types';
import { MAX_SKILLS, emptySkills, type Skill, type SkillsState } from '../skills/types';
import { stripAuto } from '../achievements/evaluate';
import { emptySettings, materialize, newShortId } from '../domain/settings';
import { exportSnapshot, parseSnapshot, type SnapshotContents } from '../domain/snapshot';
import type { AwardMap } from '../achievements/types';
import {
  clearEverything,
  clearHistory,
  dropStaleLocalHistory,
  foldExpiredMonths,
  loadAwards,
  loadJournal,
  loadSettings,
  loadSkillClicks,
  loadSkills,
  monthsToLoad,
  pruneOldMonths,
  readLocalOnly,
  saveAwards,
  saveBatteryMonth,
  saveClicksMonth,
  saveSettings,
  saveSkills,
  saveSkillsMonth,
  writeAll,
} from './legacy/persistence';
import { adoptServerState } from '../sync/adopt';
import { ensureSession } from '../sync/auth';
import { deviceId, newDeviceId } from '../sync/device';
import { readDocs, settingsDoc, skillsDoc, type ReadDocs } from '../sync/documents';
import { syncOnce } from '../sync/engine';
import { isMigrated, markMigrated, readLocalDocs, writeLocalDocs } from '../sync/local';
import { emptyBase, project } from '../sync/project';
import type { SyncDoc } from '../sync/transport';
import { createClock, emptyHlc, parseStamp, type Clock, type HlcState } from '../sync/hlc';
import type { Stamper } from '../sync/ops';
import { isRecordable, opsForClear, opsForContents, recordOps } from '../sync/record';
import { opsLog } from './local/db';
import { reduce, type Action, type Hydration, type State } from './reduce';
import { MOCK_MODE, buildMockData } from './mock';

const FLUSH_DELAY_MS = 700;

/**
 * Пауза перед отправкой на сервер. Больше, чем у записи в хранилище: там речь
 * о сохранности при внезапном закрытии, здесь — о том, чтобы десять тапов
 * подряд уехали одним запросом, а не десятью.
 */
const SYNC_DELAY_MS = 2500;

/**
 * Откат при повторах записи: задержка удваивается на каждой неудаче подряд.
 * Потолок нужен, чтобы отказавшее хранилище не съедало батарею повторами, а
 * ограничение шагов — чтобы 2 ** n не убежало в бесконечность за долгую сессию.
 */
const FLUSH_RETRY_STEPS = 6;
const FLUSH_RETRY_MAX_MS = 30_000;

/**
 * Предел ожидания гидратации. Батчи к облаку идут параллельно, поэтому запас
 * считается от одного вызова (4 с), а не от их суммы.
 */
const HYDRATE_DEADLINE_MS = 9000;

export interface StoreActions {
  /** day по умолчанию — сегодня; передаётся явно только при заполнении пропусков. */
  addBlock(priorityId: string, day?: DayKey): void;
  removeBlock(priorityId: string, day?: DayKey): void;
  setBattery(level: BatteryLevel): void;
  /**
   * Отметка задним числом: за любой день и на любую минуту. `replace` — минута
   * правимой отметки, чтобы перенос времени не оставлял старую запись.
   */
  setBatteryAt(day: DayKey, minute: number, level: BatteryLevel, replace?: number): void;
  removeBatteryShift(day: DayKey, minute: number): void;
  /** Ответ на вопрос, что посадило заряд. DRAIN_UNKNOWN — «не знаю». */
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

  /*
   * Часы устройства для меток журнала.
   *
   * Создаются лениво и заменяются при гидратации на восстановленные: до неё
   * приложение показывает заставку и правок не принимает, поэтому временные
   * часы в настоящий журнал не попадают.
   */
  /** Ссылка на отложенную отправку: она объявлена ниже, а нужна уже в `commit`. */
  const syncRef = useRef<(withDocs?: boolean) => void>(() => {});

  const clock = useRef<Clock | undefined>(undefined);
  const stamp = useCallback<Stamper>(() => {
    clock.current ??= createClock(newDeviceId());
    return clock.current.stamp();
  }, []);

  /**
   * Поднимает часы из журнала.
   *
   * Идентификатор устройства обязан пережить перезапуск: иначе сервер сочтёт
   * каждый запуск новым устройством и никогда не сможет свернуть журнал —
   * барьер свёртки считается по самому отставшему из живых.
   *
   * А вот состояние самих часов отдельно хранить незачем: метка каждой
   * операции его и содержит, поэтому достаточно взять наибольшую из журнала.
   */
  const restoreClock = useCallback(async (): Promise<void> => {
    try {
      const id = await deviceId();

      let newest = '';
      for (const op of await opsLog.all()) {
        if (op.hlc > newest) newest = op.hlc;
      }
      const parsed = parseStamp(newest);
      const state: HlcState = parsed ? { wall: parsed.wall, counter: parsed.counter } : emptyHlc();

      clock.current = createClock(id, state);
    } catch (error) {
      // Без журнала приложение работает по-прежнему — источником истины пока
      // остаётся CloudStorage, — поэтому старт из-за этого ронять нельзя.
      console.warn('[store] часы журнала не восстановились', error);
    }
  }, []);

  /**
   * Единственная точка записи в журнал операций.
   *
   * Действие сначала превращается в операции — по состоянию **до** него, — и
   * только потом уходит в reducer. Перехват здесь, а не в полутора десятках
   * методов: забытый вызов означал бы тихо потерянную правку, то есть ровно ту
   * болезнь, от которой журнал и лечит.
   */
  const commit = useCallback(
    (action: Action): void => {
      const before = latest.current;
      if (!MOCK_MODE && isRecordable(action)) {
        const ops = recordOps(before, action, stamp);
        if (ops.length > 0) {
          void opsLog.append(ops);
          // Через ссылку: отправка объявлена ниже, а замыкаться на неё отсюда
          // нельзя. Тот же приём, что и у флаша с его flushRef.
          syncRef.current();
        }
      }
      /*
       * Снимок обновляется сразу, не дожидаясь рендера.
       *
       * Две правки, попавшие в один такт, иначе увидели бы одно и то же «до»:
       * второе снятие блока с ячейки, где остался один, записало бы ещё одно
       * слагаемое, и журнал разошёлся бы с состоянием. Reducer чистый и
       * дешёвый, так что посчитать его дважды надёжнее, чем гадать, успел ли
       * React отрисоваться между двумя событиями.
       */
      latest.current = reduce(before, action);
      dispatch(action);
    },
    [stamp],
  );

  const dirtyClicks = useRef(new Set<string>());
  const dirtyBattery = useRef(new Set<string>());
  const dirtySkillClicks = useRef(new Set<string>());
  const dirtySettings = useRef(false);
  const flushTimer = useRef<number | undefined>(undefined);

  /**
   * Хранилище не прочиталось. Пустая память в этом случае не означает «данных нет» —
   * она означает «их не отдали», и запись затёрла бы живое облако. Флаг снимается
   * первым успешным чтением и до тех пор запрещает любую запись.
   */
  const loadFailed = useRef(false);

  /**
   * Пишем ли ещё в CloudStorage.
   *
   * Гаснет ровно в тот момент, когда устройство перешло на журнал. Ни секундой
   * раньше: пока переход не подтверждён, прежнее хранилище остаётся источником
   * истины, и переставшая писать в него запись заморозила бы данные.
   */
  const legacyWrites = useRef(true);
  /** Идущая запись: сброс обязан её дождаться, иначе она допишет уже стёртое. */
  const activeFlush = useRef<Promise<void>>(Promise.resolve());
  /** Неудачи подряд — задержка повтора растёт, чтобы не долбить отказавшее хранилище. */
  const flushFailures = useRef(0);
  /** Ссылка на сам флаш: повтор планируется изнутри, а замыкаться на себя нельзя. */
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const scheduleRetry = useCallback(() => {
    const steps = Math.min(flushFailures.current, FLUSH_RETRY_STEPS);
    const delay = Math.min(FLUSH_DELAY_MS * 2 ** steps, FLUSH_RETRY_MAX_MS);
    window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => void flushRef.current(), delay);
  }, []);

  const flush = useCallback(async () => {
    const run = (async () => {
      if (MOCK_MODE) return;
      window.clearTimeout(flushTimer.current);
      flushTimer.current = undefined;
      if (loadFailed.current) return;

      // Устройство перешло на журнал — прежнему хранилищу писать нечего.
      // Метки снимаем: без этого они копились бы до конца сеанса.
      if (!legacyWrites.current) {
        dirtyClicks.current.clear();
        dirtyBattery.current.clear();
        dirtySkillClicks.current.clear();
        dirtySettings.current = false;
        return;
      }

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
          scheduleRetry();
        }
        flushFailures.current = 0;
      } catch (error) {
        // Возвращаем метки и взводим повтор: без него «повторим позже» означало
        // «повторим, если пользователь сам нажмёт что-нибудь ещё».
        console.warn('[store] запись не удалась, повторим позже', error);
        months.clicks.forEach((m) => dirtyClicks.current.add(m));
        months.battery.forEach((m) => dirtyBattery.current.add(m));
        months.skills.forEach((m) => dirtySkillClicks.current.add(m));
        if (settingsDirty) dirtySettings.current = true;
        flushFailures.current += 1;
        scheduleRetry();
      }
    })();

    activeFlush.current = run;
    await run;
  }, [scheduleRetry]);

  flushRef.current = flush;

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
  /**
   * Каталог навыков и достижения пишутся так же немедленно и по той же причине.
   * Цепочки у них раздельные: общая означала бы, что таймаут записи каталога
   * задерживает выдачу достижения, хотя это разные ключи и разные данные.
   */
  const pendingSkills = useRef<Promise<void>>(Promise.resolve());
  const pendingAwards = useRef<Promise<void>>(Promise.resolve());

  const writeSettings = useCallback(
    (settings: Settings) => {
      if (MOCK_MODE || loadFailed.current || !legacyWrites.current) return;
      // Через цепочку, а не поверх предыдущей записи: две параллельные могли
      // завершиться в обратном порядке, и в облаке побеждал более старый список.
      pendingSettings.current = pendingSettings.current
        .then(() => saveSettings(settings))
        .catch((error) => {
          console.warn('[store] настройки не записались, повторим общим флашем', error);
          dirtySettings.current = true;
          scheduleFlush();
        });
    },
    [scheduleFlush],
  );

  const writeSkills = useCallback((skills: SkillsState): Promise<void> => {
    if (MOCK_MODE || loadFailed.current || !legacyWrites.current) return Promise.resolve();
    pendingSkills.current = pendingSkills.current.then(() => saveSkills(skills));
    // Наружу отдаём цепочку с проглоченной ошибкой, но саму ошибку не теряем:
    // свёртка месяцев обязана знать, дошла запись или нет.
    const written = pendingSkills.current;
    pendingSkills.current = written.catch((error) =>
      console.warn('[store] каталог навыков не записался', error),
    );
    return written;
  }, []);

  const writeAwards = useCallback((awards: AwardMap) => {
    if (MOCK_MODE || loadFailed.current || !legacyWrites.current) return;
    pendingAwards.current = pendingAwards.current
      .then(() => saveAwards(awards))
      .catch((error) => console.warn('[store] достижения не записались', error));
  }, []);

  /**
   * Отправка на сервер: отложенная и объединяющая, как и запись в хранилище.
   *
   * Пауза больше, чем у флаша, намеренно: там речь о сохранности при закрытии
   * приложения, здесь — о трафике. Десять тапов подряд должны уехать одним
   * запросом, а не десятью.
   *
   * Документ кладётся в очередь целиком и с меткой, полученной в момент правки.
   * Метка та же, что ушла в локальную копию: разойдись они — и собственная
   * запись выглядела бы то новее, то старее самой себя.
   */
  const syncTimer = useRef<number | undefined>(undefined);
  const pendingDocs = useRef(new Map<SyncDoc['kind'], SyncDoc>());

  /** Правка документа: сразу на диск, в очередь отправки и к таймеру. */
  const queueDoc = useCallback(
    (doc: SyncDoc) => {
      if (MOCK_MODE) return;
      pendingDocs.current.set(doc.kind, doc);
      void writeLocalDocs([doc]);
    },
    [],
  );

  const runSync = useCallback(async () => {
    window.clearTimeout(syncTimer.current);
    syncTimer.current = undefined;
    if (MOCK_MODE || loadFailed.current) return;

    const docs = [...pendingDocs.current.values()];
    // Очередь снимается до отправки: правка, случившаяся во время запроса,
    // должна встать в неё заново, а не потеряться под уже отправленной.
    pendingDocs.current.clear();

    const outcome = await syncOnce(undefined, docs);
    if (outcome.docs.length > 0) await writeLocalDocs(outcome.docs);
    if (!outcome.ok) {
      // Не ушли — возвращаем, но не поверх более свежих: там могла оказаться
      // правка, сделанная за время запроса.
      for (const doc of docs) {
        const newer = pendingDocs.current.get(doc.kind);
        if (!newer || newer.hlc < doc.hlc) pendingDocs.current.set(doc.kind, doc);
      }
    }
  }, []);

  const scheduleSync = useCallback(() => {
    if (MOCK_MODE) return;
    window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => void runSync(), SYNC_DELAY_MS);
  }, [runSync]);

  syncRef.current = scheduleSync;

  /** Отменяет всё, что ещё не записано. Нужно перед сбросом, чтобы стёртое не вернулось. */
  const dropPendingWrites = useCallback(async () => {
    // Сначала гасим таймер, чтобы за время ожидания не стартовал новый флаш.
    window.clearTimeout(flushTimer.current);
    flushTimer.current = undefined;

    // Незавершённая запись иначе доедет уже после очистки и воскресит стёртое.
    // Ждём и уже идущий флаш: гашения таймера мало — он мог стартовать секунду назад.
    await activeFlush.current;
    await pendingSettings.current;
    await pendingSkills.current;
    await pendingAwards.current;

    // Метки чистим только теперь. Упавший флаш возвращает свои месяцы в очередь
    // и взводит повтор — сделай мы это до ожидания, он переписал бы стёртое.
    window.clearTimeout(flushTimer.current);
    flushTimer.current = undefined;
    flushFailures.current = 0;
    dirtyClicks.current.clear();
    dirtyBattery.current.clear();
    dirtySkillClicks.current.clear();
    dirtySettings.current = false;
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
      commit({
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
      void readLocalOnly().then((local) => {
        // skillsLoaded только если копия действительно прочиталась: безусловное
        // «прочитано» снимало защиту флаша и разрешало записать пустой месяц
        // навыков поверх облачного.
        if (!local.ok) loadFailed.current = true;
        finish({ ...local, skillsLoaded: local.ok });
      });
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

      /*
       * Каждое чтение под своим try. Общий означал бы, что отказ первого обнуляет
       * остальные: без настроек приложение уходит в онбординг, а выбор набора
       * записывает пустой список поверх живого облака.
       */
      let failed = false;
      const read = async <T,>(what: string, load: () => Promise<T>, fallback: T): Promise<T> => {
        try {
          return await load();
        } catch (error) {
          console.warn(`[store] не прочитано: ${what}`, error);
          failed = true;
          return fallback;
        }
      };

      // Часы поднимаются до первой возможной правки. Ошибка внутри заглушена:
      // без журнала приложение работает по-прежнему, а вот без данных — нет.
      await restoreClock();

      /*
       * Вход — фоном и без ожидания.
       *
       * Ждать его нельзя ни секунды: приложение обязано открыться из локальной
       * копии независимо от сети и сессии. Сессия нужна следующему этапу, где
       * появится обмен операциями, а сейчас она только зажигает строку в
       * настройках и заводит профиль на сервере.
       */
      void ensureSession();

      /*
       * Переезд уже был — читаем журнал, а не прежнее хранилище.
       *
       * Это и есть переключатель: с этого момента источник истины на устройстве
       * — операции, а CloudStorage только читается при разовом переносе ниже.
       * Держать чтение там дальше нельзя: запись туда прекращается, и экран
       * показывал бы вчерашнее, пока журнал уходит вперёд.
       */
      if (await read('отметка о переезде', isMigrated, false)) {
        // Переезд был — писать в прежнее хранилище больше не нужно. Забыть эту
        // строку значит возобновлять запись при каждом перезапуске.
        legacyWrites.current = false;

        const ops = await read('журнал операций', () => opsLog.all(), []);
        const docs = await read<ReadDocs>('настройки и навыки', readLocalDocs, {});
        if (failed) loadFailed.current = true;

        const projected = project(emptyBase(), ops);
        window.clearTimeout(deadline);
        if (cancelled) return;

        finish({
          settings: docs.settings,
          journal: projected.journal,
          skills: docs.skills ?? emptySkills(),
          skillClicks: projected.skillClicks,
          awards: projected.awards,
          // Журнал содержит историю навыков наравне с остальной: отдельной
          // догрузки, ради которой существовал этот флаг, больше нет.
          skillsLoaded: true,
        });

        // Дальше только обмен: свёртка и уборка — заботы прежнего хранилища.
        void (async () => {
          if (failed || cancelled) return;
          const outcome = await syncOnce();
          if (!outcome.ok || cancelled) return;
          if (outcome.docs.length > 0) await writeLocalDocs(outcome.docs);
          if (outcome.pulled === 0 && outcome.docs.length === 0) return;

          const fresh = project(emptyBase(), await opsLog.all());
          const pulled = readDocs(outcome.docs);
          if (cancelled) return;
          commit({
            type: 'hydrate',
            settings: pulled.settings ?? docs.settings ?? emptySettings(),
            journal: fresh.journal,
            skills: pulled.skills ?? docs.skills ?? emptySkills(),
            skillClicks: fresh.skillClicks,
            awards: fresh.awards,
            skillsLoaded: true,
          });
        })();
        return;
      }

      /*
       * До чтения истории: если её стёрли на другом устройстве, локальная копия
       * здесь ещё цела и при слиянии воскресила бы стёртое. Ошибки внутри
       * заглушены — сверка не должна мешать старту.
       */
      await dropStaleLocalHistory();

      settings = await read('настройки', loadSettings, undefined);
      /*
       * Каталог навыков и достижения читаются всегда, даже при выключенном
       * модуле: иначе выключенный и снова включённый модуль показал бы пустой
       * список, а первая же запись стёрла бы облачные данные. Гейтится только
       * история по месяцам — она и стоит запросов.
       */
      skills = await read('каталог навыков', loadSkills, emptySkills());
      awards = await read('достижения', loadAwards, {});
      journal = await read('журнал', () => loadJournal(monthsToLoad()), emptyJournal());

      const skillsModuleOn = modulesOf(settings ?? emptySettings()).skills;
      if (skillsModuleOn) {
        const before = failed;
        skillClicks = await read('история навыков', () => loadSkillClicks(monthsToLoad()), {});
        skillsLoaded = failed === before;
      }

      // Пока хоть что-то не прочиталось, писать нельзя: пустая память здесь
      // означает «не отдали», а не «нет данных».
      if (failed) loadFailed.current = true;

      window.clearTimeout(deadline);
      if (cancelled) return;

      finish({ settings, journal, skills, skillClicks, awards, skillsLoaded });

      // Свёртка строго до уборки: она читает те самые месяцы, что уборка удалит.
      void (async () => {
        if (failed) return;
        let current = skills;
        const folded = await foldExpiredMonths(skills);
        if (cancelled) return;

        if (folded) {
          commit({ type: 'skills', skills: folded });
          try {
            // Уборка сносит исходные месяцы, поэтому запускать её можно только
            // после подтверждённой записи свёртки — иначе carryBlocks теряется.
            await writeSkills(folded);
          } catch (error) {
            console.warn('[store] свёртка не записалась, уборку откладываем', error);
            return;
          }
          current = folded;
        }
        await pruneOldMonths();
        if (cancelled) return;

        /*
         * Переход на сервер идёт последним и строго после уборки: засеять его
         * недосвёрнутым состоянием значило бы отправить туда часы, которые тут
         * же переедут в carryBlocks, и посчитать их дважды.
         */
        let history = skillClicks;
        if (!skillsLoaded) {
          /*
           * История навыков читается, даже если модуль выключен.
           *
           * При выключенном модуле она в память не грузится, и засев отправил
           * бы на сервер состояние без неё — то есть стёр бы годы занятий у
           * того, кто просто убрал вкладку с глаз.
           */
          history = await read('история навыков для засева', () => loadSkillClicks(monthsToLoad()), {});
          if (failed || cancelled) return;
        }

        const adopted = await adoptServerState(
          { settings: settings ?? emptySettings(), journal, skills: current, skillClicks: history, awards },
          stamp,
        );
        if (!adopted || cancelled) return;

        /*
         * Переезд состоялся: с этого момента источник истины — журнал, и в
         * CloudStorage больше не пишем.
         *
         * Отметка ставится только здесь, после подтверждённого обмена. Пока
         * его не было, устройство живёт по-старому целиком: читает и пишет
         * прежнее хранилище. Так оффлайн и отсутствие сессии не оставляют
         * человека с замороженными данными.
         */
        await markMigrated();
        legacyWrites.current = false;

        commit({
          type: 'hydrate',
          settings: adopted.settings ?? settings ?? emptySettings(),
          journal: adopted.journal,
          skills: adopted.skills ?? current,
          skillClicks: adopted.skillClicks,
          awards: adopted.awards,
          skillsLoaded: true,
        });
        console.info(adopted.seeded ? '[sync] сервер засеян' : '[sync] состояние взято с сервера');
      })();
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(deadline);
    };
  }, [commit, restoreClock, writeSkills]);

  /*
   * Сворачивание мини-аппа не даёт времени на отложенную запись — дожимаем
   * немедленно. Отправка на сервер идёт следом и без ожидания: она может не
   * успеть, и это нормально — операции остаются в очереди и уедут при
   * следующем открытии. А вот запись в хранилище успеть обязана.
   */
  useEffect(() => {
    const hide = (): void => {
      void flush();
      void runSync();
    };
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') hide();
    };
    // Именованная, а не инлайновая: анонимную снять нельзя, и при каждой смене
    // flush поверх старого слушателя вешался ещё один — с устаревшим замыканием.
    const onPageHide = (): void => hide();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [flush, runSync]);

  /**
   * Сегодняшний день как состояние, а не как вычисление на каждый рендер.
   *
   * Раньше он пересчитывался только при случайном ре-рендере, поэтому открытое
   * в полночь приложение могло часами считать «сегодня» вчерашним днём. Таймер
   * ставится ровно на ближайшую полночь и перевзводится сам.
   */
  const [today, setToday] = useState(todayKey);

  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    // Секунда сверху: таймер, сработавший на миллисекунду раньше полуночи,
    // прочитал бы прежнюю дату и взвёлся бы на нулевую задержку.
    const timer = window.setTimeout(() => setToday(todayKey()), midnight.getTime() - now.getTime() + 1000);
    return () => window.clearTimeout(timer);
  }, [today]);

  const actions = useMemo<StoreActions>(() => {
    const commitSettings = (settings: Settings): void => {
      commit({ type: 'settings', settings });
      writeSettings(settings);
      // Настройки и каталог едут документом целиком, а не операциями: это
      // связные объекты, порядок приоритетов не набор независимых ячеек.
      queueDoc(settingsDoc(settings, stamp));
      scheduleSync();
    };

    const commitSkills = (skills: SkillsState): void => {
      commit({ type: 'skills', skills });
      writeSkills(skills);
      queueDoc(skillsDoc(skills, stamp));
      scheduleSync();
    };

    const commitAwards = (awards: AwardMap, fresh: string[] = []): void => {
      commit({ type: 'awards', awards, fresh });
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
        commit({ type: 'blocks', day, priorityId, delta: 1 });
        markClicks(day);
      },

      removeBlock(priorityId, day = todayKey()) {
        commit({ type: 'blocks', day, priorityId, delta: -1 });
        markClicks(day);
      },

      setBattery(level) {
        const now = new Date();
        const day = todayKey(now);
        const minute = minuteOfDay(now);

        // Повтор того же уровня ничего не меняет — лишняя запись только раздувает
        // месяц. Проверка живёт здесь, а не в reducer: это правило живого нажатия,
        // а не правки задним числом, где такая отметка может быть осмысленной.
        const existing = latest.current.journal.battery[day] ?? [];
        const last = existing[existing.length - 1];
        if (last && last[1] === level && last[0] <= minute) return;

        commit({ type: 'battery-set', day, minute, level });
        markBattery(day);
      },

      setBatteryAt(day, minute, level, replace) {
        commit({
          type: 'battery-set',
          day,
          minute,
          level,
          ...(replace === undefined ? {} : { replace }),
        });
        markBattery(day);
      },

      removeBatteryShift(day, minute) {
        commit({ type: 'battery-remove', day, minute });
        markBattery(day);
      },

      setDrain(drainedBy) {
        // День берём у самого перехода, а не у «сейчас»: между вопросом в 23:59 и
        // ответом в 00:01 сутки успевают смениться, и пометка ушла бы не в тот месяц.
        const battery = latest.current.journal.battery;
        const today = todayKey();
        const day = battery[today]?.length
          ? today
          : Object.keys(battery)
              .filter((key) => (battery[key]?.length ?? 0) > 0)
              .sort()
              .pop();
        if (day === undefined) return;

        commit({ type: 'drain', day, drainedBy });
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
            commit({ type: 'skill-journal', skillClicks: clicks, skillsLoaded: true });
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
          // Math.max(0, NaN) — это NaN, а не ноль: нечисло отравляло всю сумму
          // часов, а при записи превращалось в null и обнуляло стартовый капитал.
          ...(patch.baseMinutes !== undefined
            ? {
                baseMinutes: Number.isFinite(patch.baseMinutes)
                  ? Math.max(0, Math.round(patch.baseMinutes))
                  : skill.baseMinutes,
              }
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
        commit({ type: 'skill-blocks', day, skillId, delta: 1 });
        markSkillClicks(day);
      },

      removeSkillBlock(skillId, day = todayKey()) {
        commit({ type: 'skill-blocks', day, skillId, delta: -1 });
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
        commit({ type: 'dismiss-fresh' });
      },

      async resetHistory() {
        // Сначала гасим отложенную запись: иначе таймер, взведённый последним
        // кликом, допишет только что стёртый месяц обратно.
        await dropPendingWrites();
        const current = latest.current;

        /*
         * Барьер в журнале — замена «поколению истории». Удаление ключа в
         * облаке само по себе не доезжало до второго устройства, и стёртый
         * месяц возвращался оттуда обратно; барьер едет вместе с остальными
         * операциями и действует тем же порядком, что и они.
         *
         * Достижений он не касается: снятие автоматических приедет отдельными
         * операциями из commitAwards ниже.
         */
        if (!MOCK_MODE) void opsLog.append(opsForClear(stamp));

        commit({ type: 'journal', journal: emptyJournal() });
        commit({ type: 'skill-journal', skillClicks: {}, skillsLoaded: current.skillsLoaded });

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

        // Барьер плюс снятие всех отметок: барьер историю не трогает выборочно,
        // а достижения он не отменяет вовсе — их надо снять поимённо.
        if (!MOCK_MODE) {
          void opsLog.append([
            ...opsForClear(stamp),
            ...recordOps(latest.current, { type: 'awards', awards: {} }, stamp),
          ]);
        }

        commit({
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
        // Запись идёт до удаления лишнего — writeAll сносит месяцы, которых нет
        // в копии, только после того, как записал её саму. Отказ облака посреди
        // импорта теперь оставляет прежние данные, а не пустое хранилище.
        await writeAll(restored);

        /*
         * Копия заменяет историю целиком, поэтому в журнал уходит барьер и
         * итоги по каждой ячейке — установкой, а не слагаемыми: прогнать
         * восстановление дважды должно быть безопасно.
         *
         * Старый журнал перед этим стирается: его операции всё равно отсечёт
         * барьер, а место они занимать продолжали бы.
         */
        if (!MOCK_MODE) {
          await opsLog.clear();
          void opsLog.append(opsForContents(restored, stamp));
        }

        commit({ type: 'hydrate', ...restored, skillsLoaded: true });
        return restored;
      },
    };
  }, [
    commit,
    stamp,
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
