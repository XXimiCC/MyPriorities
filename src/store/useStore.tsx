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

import { writeDiagnosticSnapshot } from '../devkitHost';
import { minuteOfDay, todayKey } from '../domain/date';
import { nextFreeColorId } from '../domain/palette';
import { PRESETS, titlesOf } from '../domain/presets';
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
  type SettingsMark,
} from '../domain/types';
import { MAX_SKILLS, emptySkills, type Skill, type SkillsState } from '../skills/types';
import { stripAuto } from '../achievements/evaluate';
import { emptySettings, materialize, newShortId } from '../domain/settings';
import { exportSnapshot, parseSnapshot, type SnapshotContents } from '../domain/snapshot';
import type { AwardMap } from '../achievements/types';

import { adoptServerState, restoreBeforeSync } from '../sync/adopt';
import { importLegacyOnce } from '../sync/import';
import { ensureSession } from '../sync/auth';
import { deviceId, newDeviceId } from '../sync/device';
import { settingsDoc, skillsDoc, type ReadDocs } from '../sync/documents';
import { syncOnce } from '../sync/engine';
import { readLocalBase, readLocalDocs, writeLocalDocs } from '../sync/local';
import { emptyBase, project } from '../sync/project';
import type { SyncDoc } from '../sync/transport';
import { createClock, emptyHlc, parseStamp, type Clock, type HlcState } from '../sync/hlc';
import type { Stamper } from '../sync/ops';
import { isRecordable, opsForClear, opsForContents, recordOps } from '../sync/record';
import { opsLog } from './local/db';
import { reduce, type Action, type Hydration, type State } from './reduce';
import { DEMO_ID } from '../demo/mode';
import { buildProfile } from '../demo/profiles';

/**
 * Пауза перед отправкой на сервер. Больше, чем у записи в хранилище: там речь
 * о сохранности при внезапном закрытии, здесь — о том, чтобы десять тапов
 * подряд уехали одним запросом, а не десятью.
 */
const SYNC_DELAY_MS = 2500;

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

  /**
   * Отмечает единожды случившееся: копия снята, предупреждение закрыто.
   * Снять отметку нельзя — это и есть смысл слова «единожды».
   */
  markOnce(mark: SettingsMark): void;

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
  /**
   * Вернуть данные, какими они были до переезда на сервер.
   *
   * Отвечает числом долитых операций либо undefined, если копии нет или обмен
   * не удался. Во втором случае не изменилось ничего.
   */
  restoreBeforeSync(): Promise<number | undefined>;

  /**
   * Дописать всё отложенное прямо сейчас.
   *
   * Нужно перед перезагрузкой страницы, которой открывается демо: клик,
   * сделанный за полсекунды до входа, иначе уедет вместе с ней. Тот же путь,
   * что и при уходе приложения в фон, только вызванный руками.
   */
  flushPending(): Promise<void>;
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
      if (isRecordable(action)) {
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

  /**
   * Хранилище не прочиталось. Пустая память в этом случае не означает «данных
   * нет» — она означает «их не отдали». Флаг снимается первым успешным чтением
   * и до тех пор запрещает любую запись.
   */
  const loadFailed = useRef(false);

  /**
   * Отправка на сервер: отложенная и объединяющая.
   *
   * Пауза здесь про трафик: десять тапов подряд должны уехать одним запросом, а
   * не десятью. О сохранности она не говорит ничего — операции ложатся в журнал
   * сразу, в тот же такт, что и правка состояния. Прежде рядом жил ещё и
   * отложенный флаш в старое хранилище с повторами и откатом; он исчез вместе с
   * самим хранилищем как местом записи.
   *
   * Документ кладётся в очередь целиком и с меткой, полученной в момент правки.
   * Метка та же, что ушла в локальную копию: разойдись они — и собственная
   * запись выглядела бы то новее, то старее самой себя.
   */
  const syncTimer = useRef<number | undefined>(undefined);
  const pendingDocs = useRef(new Map<SyncDoc['kind'], SyncDoc>());

  /**
   * Правка документа: сразу на диск и в очередь отправки.
   *
   * Под защитой loadFailed, в отличие от операций. Операция — слагаемое, она
   * ляжет поверх непрочитанной истории без вреда; документ же заменяет собой
   * весь список приоритетов, и записанный поверх непрочитанного он его сотрёт.
   */
  const queueDoc = useCallback((doc: SyncDoc) => {
    if (loadFailed.current) return;
    pendingDocs.current.set(doc.kind, doc);
    void writeLocalDocs([doc]);
  }, []);

  const runSync = useCallback(async () => {
    window.clearTimeout(syncTimer.current);
    syncTimer.current = undefined;
    if (loadFailed.current) return;

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
    window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => void runSync(), SYNC_DELAY_MS);
  }, [runSync]);

  syncRef.current = scheduleSync;

  /**
   * Отменяет всё, что ещё не отправлено. Нужно перед сбросом: документ из
   * очереди иначе уехал бы уже после него и вернул стёртое.
   *
   * Журнал здесь не при чём: сброс сам пишет в него барьер, и операции до
   * барьера в проекцию не попадают, доехали они на сервер или нет.
   */
  const dropPendingWrites = useCallback(async () => {
    window.clearTimeout(syncTimer.current);
    syncTimer.current = undefined;
    pendingDocs.current.clear();
  }, []);

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
      /*
       * Читать в обход больше неоткуда: журнал и есть та самая локальная копия,
       * мимо которой раньше шёл этот путь. Раз она не отдалась за девять секунд,
       * значит хранилище устройства не отвечает вовсе.
       *
       * Показываем пустой экран и запрещаем запись документов: пустая память
       * здесь означает «не отдали», и записанные поверх настройки стёрли бы
       * живой список приоритетов. Операции запрещать не нужно — они слагаемые
       * и лягут поверх настоящей истории, когда та прочитается.
       */
      console.warn('[store] хранилище устройства не ответило, открываемся пустыми');
      loadFailed.current = true;
      finish({ settings: undefined, skillsLoaded: false });
    }, HYDRATE_DEADLINE_MS);

    void (async () => {
      /*
       * Демо: синтетика вместо чтения. Единственная оставшаяся проверка режима
       * в сторе — и это не предохранитель, а способ загрузить данные. От записи
       * демо держит не она, а подменённое хранилище: `store/local/db.ts`,
       * `telegram/cloudStorage.ts` и `sync/transport.ts`.
       */
      if (DEMO_ID) {
        finish({ ...buildProfile(DEMO_ID), skillsLoaded: true });
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
       * Перенос из прежнего хранилища — до всего остального и без сети.
       *
       * Раньше здесь была развилка: переехали — читаем журнал, не переехали —
       * читаем прежнее хранилище и пишем в оба. Развилка стоила потери данных,
       * потому что «переехал ли я» зависело от того, ответил ли сервер.
       *
       * Теперь перенос целиком местный и делается один раз. Не удался — не
       * страшно: он вернёт undefined, отметки не поставит, и следующий запуск
       * попробует снова. Дальше путь один во всех случаях: журнал.
       */
      const imported = await read('перенос из прежнего хранилища', () => importLegacyOnce(stamp), undefined);

      const docs = await read<ReadDocs>('настройки и навыки', readLocalDocs, {});
      const ops = await read('журнал операций', () => opsLog.all(), []);
      const base = await read('свёрнутая история', readLocalBase, emptyBase());
      if (failed) loadFailed.current = true;

      const projected = project(base, ops);
      window.clearTimeout(deadline);
      if (cancelled) return;

      settings = docs.settings ?? imported?.contents.settings;
      skills = docs.skills ?? imported?.contents.skills ?? emptySkills();
      journal = projected.journal;
      skillClicks = projected.skillClicks;
      awards = projected.awards;
      // Журнал содержит историю навыков наравне с остальной: отдельной
      // догрузки, ради которой существовал этот флаг, больше нет.
      skillsLoaded = true;

      finish({ settings, journal, skills, skillClicks, awards, skillsLoaded });

      /*
       * Обмен с сервером — фоном и последним.
       *
       * Он больше ничего не решает: своё уже в журнале, и приложение работает
       * целиком без него. Здесь только «отдать недостающее и забрать чужое».
       */
      void (async () => {
        if (failed || cancelled) return;

        const adopted = await adoptServerState(
          { settings: settings ?? emptySettings(), journal, skills, skillClicks, awards },
          stamp,
        );
        if (!adopted || cancelled) return;

        commit({
          type: 'hydrate',
          settings: adopted.settings ?? settings ?? emptySettings(),
          journal: adopted.journal,
          skills: adopted.skills ?? skills,
          skillClicks: adopted.skillClicks,
          awards: adopted.awards,
          skillsLoaded: true,
        });
        console.info(`[sync] обмен состоялся, долито операций: ${adopted.filled}`);
      })();
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(deadline);
    };
  }, [commit, restoreClock, stamp]);

  /*
   * Сворачивание мини-аппа не даёт времени на отложенную запись — дожимаем
   * немедленно. Отправка на сервер идёт следом и без ожидания: она может не
   * успеть, и это нормально — операции остаются в очереди и уедут при
   * следующем открытии. А вот запись в хранилище успеть обязана.
   */
  useEffect(() => {
    const hide = (): void => {
      void runSync();
    };
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') hide();
    };
    // Именованная, а не инлайновая: анонимную снять нельзя, и при каждой смене
    // runSync поверх старого слушателя вешался бы ещё один — с устаревшим замыканием.
    const onPageHide = (): void => hide();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [runSync]);

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
      // Настройки и каталог едут документом целиком, а не операциями: это
      // связные объекты, порядок приоритетов не набор независимых ячеек.
      queueDoc(settingsDoc(settings, stamp));
      scheduleSync();
    };

    const commitSkills = (skills: SkillsState): void => {
      commit({ type: 'skills', skills });
      queueDoc(skillsDoc(skills, stamp));
      scheduleSync();
    };

    const commitAwards = (awards: AwardMap, fresh: string[] = []): void => {
      // Достижения едут операциями, которые запишет сам commit: отдельной
      // записи, как у настроек и каталога, им не нужно.
      commit({ type: 'awards', awards, fresh });
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
      },

      removeBlock(priorityId, day = todayKey()) {
        commit({ type: 'blocks', day, priorityId, delta: -1 });
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
      },

      setBatteryAt(day, minute, level, replace) {
        /*
         * Будущего в журнале не бывает: отметка означает «уже случилось», и
         * время позже текущей минуты сделало бы «текущим» состояние, которое
         * ещё не наступило. Шторка такое время сохранить не даёт, но правило
         * стоит и здесь: иначе оно держалось бы на одном экране, а через него
         * ходят и правка задним числом, и перенос времени.
         *
         * Время подрезается, а не отбрасывается вместе с действием: человек
         * отмечает состояние, а не время, и молча потерять отметку хуже, чем
         * поставить её на «сейчас».
         */
        const now = new Date();
        const at = day === todayKey(now) ? Math.min(minute, minuteOfDay(now)) : minute;

        commit({
          type: 'battery-set',
          day,
          minute: at,
          level,
          ...(replace === undefined ? {} : { replace }),
        });
      },

      removeBatteryShift(day, minute) {
        commit({ type: 'battery-remove', day, minute });
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
        const priorities = materialize(titlesOf(preset.priorities), known);

        const keptIds = new Set(priorities.map((p) => p.id));
        const archived = [
          ...current.archived.filter((p) => !keptIds.has(p.id)),
          ...current.priorities.filter((p) => !keptIds.has(p.id)),
        ];

        // blockMinutes, modules и отметки переносятся: цена блока, набор
        // включённых модулей и то, что человеку уже показали, — личные
        // настройки, а не часть сборника приоритетов.
        commitSettings({
          version: 1,
          priorities,
          archived,
          presetId,
          onboarded: true,
          blockMinutes: current.blockMinutes,
          modules: current.modules,
          exported: current.exported,
          localOnlySeen: current.localOnlySeen,
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
        const current = latest.current.settings;
        commitSettings({ ...current, modules: { ...modulesOf(current), [id]: on } });
      },

      markOnce(mark) {
        const current = latest.current.settings;
        // Повторная отметка — лишняя запись настроек и лишний обмен с сервером.
        if (current[mark]) return;
        commitSettings({ ...current, [mark]: true });
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
      },

      removeSkillBlock(skillId, day = todayKey()) {
        commit({ type: 'skill-blocks', day, skillId, delta: -1 });
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
        void opsLog.append(opsForClear(stamp));

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
      },

      async resetEverything() {
        await dropPendingWrites();

        // Барьер плюс снятие всех отметок: барьер историю не трогает выборочно,
        // а достижения он не отменяет вовсе — их надо снять поимённо.
        void opsLog.append([
          ...opsForClear(stamp),
          ...recordOps(latest.current, { type: 'awards', awards: {} }, stamp),
        ]);

        commit({
          type: 'hydrate',
          settings: emptySettings(),
          journal: emptyJournal(),
          skills: emptySkills(),
          skillClicks: {},
          awards: {},
          skillsLoaded: true,
        });
      },

      exportData() {
        const { settings, journal, skills, skillClicks, awards } = latest.current;
        return exportSnapshot({ settings, journal, skills, skillClicks, awards });
      },

      async importData(json) {
        const restored = parseSnapshot(json);
        await dropPendingWrites();

        /*
         * Копия заменяет историю целиком, поэтому в журнал уходит барьер и
         * итоги по каждой ячейке — установкой, а не слагаемыми: прогнать
         * восстановление дважды должно быть безопасно.
         *
         * Старый журнал перед этим стирается: его операции всё равно отсечёт
         * барьер, а место они занимать продолжали бы.
         */
        await opsLog.clear();
        await opsLog.append(opsForContents(restored, stamp));
        queueDoc(settingsDoc(restored.settings, stamp));
        queueDoc(skillsDoc(restored.skills, stamp));
        scheduleSync();

        commit({ type: 'hydrate', ...restored, skillsLoaded: true });
        return restored;
      },

      async restoreBeforeSync() {
        /*
         * Возврат к тому, что было до переезда на сервер.
         *
         * Идёт доливкой, а не заменой: переезд мог обидеть не одно устройство,
         * и барьер здесь означал бы, что вернувший данные последним стирает
         * вернувшего первым. Подробности — в `sync/adopt.ts`.
         */
        const restored = await restoreBeforeSync(stamp);
        if (!restored) return undefined;

        const { settings, skills } = latest.current;
        commit({
          type: 'hydrate',
          settings: restored.settings ?? settings,
          journal: restored.journal,
          skills: restored.skills ?? skills,
          skillClicks: restored.skillClicks,
          awards: restored.awards,
          skillsLoaded: true,
        });
        return restored.filled;
      },

      async flushPending() {
        // Журнал пишется в тот же такт, что и правка, поэтому дожимать нечего:
        // остаётся только отдать накопленное серверу, пока приложение живо.
        await runSync();
      },
    };
  }, [commit, stamp, queueDoc, scheduleSync, runSync, dropPendingWrites]);

  /* Панель отладки читает состояние отсюда, из модульной ячейки: она живёт в
     отдельном корне React и до контекста не дотягивается. Уходят только числа —
     см. devkitHost.ts, там же и объяснение почему. */
  useEffect(() => {
    writeDiagnosticSnapshot(state);
  }, [state]);

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
