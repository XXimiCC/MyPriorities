/**
 * Переход на сервер как на источник истины.
 *
 * Самое опасное место всего переезда, поэтому порядок здесь важнее краткости.
 *
 * Первое: приложение уже показало то, что нашло на устройстве. Всё, что
 * происходит дальше, идёт фоном и может не получиться — тогда не меняется
 * ничего, и следующий запуск попробует снова.
 *
 * Второе: перед любым переключением делается копия локальных данных. Она нужна
 * не от недоверия к коду, а от того, что у разных устройств истории разные:
 * CloudStorage никогда не работал, и каждое устройство копило своё. Чья-то
 * история неизбежно окажется не первой, и терять её молча нельзя.
 *
 * Третье, и это исправление после настоящей потери данных: переход **ничего не
 * заменяет**. Прежде он выбирал — пусто на сервере, значит отправляем своё,
 * не пусто, значит забираем чужое и живём им. Второе означало, что устройство,
 * пришедшее вторым, выбрасывало свою историю: она лежит в прежнем хранилище, а
 * не в журнале, и в проекции её нет. Причём «не пусто» устройство устраивало
 * себе само — одним нажатием, уехавшим на сервер до первого удачного перехода.
 *
 * Теперь вместо выбора считается разница: сначала забираем чужое, потом
 * доливаем то, чего на сервере нет (`opsToFill`). Обе истории остаются целы.
 */

import type { SnapshotContents } from '../domain/snapshot';
import { exportSnapshot, parseSnapshot } from '../domain/snapshot';
import type {
  AwardMap,
  BatteryShift,
  ClicksMap,
  DayKey,
  Priority,
  Settings,
} from '../domain/types';
import { opsLog } from '../store/local/db';
import { readDocs, settingsDoc, skillsDoc, type ReadDocs } from './documents';
import { contribute, rewindCursor, serverState, syncOnce, type EngineDeps } from './engine';
import { opsToFill } from './fill';
import { readLocalBase, writeLocalDocs } from './local';
import type { Op, Stamper } from './ops';
import { project, type Projected } from './project';
import type { SyncDoc } from './transport';

/** Где лежит страховочная копия. Одна на устройство: делается раз, перед переходом. */
const BACKUP_KEY = 'backup:before-sync';

export interface Adopted extends Projected, ReadDocs {
  /** Сколько своего пришлось долить на сервер. Ноль — там уже всё было. */
  filled: number;
}

/**
 * Есть ли что спасать.
 *
 * Устройство без истории и без приоритетов — новое: терять ему нечего, а копия
 * пустоты хуже, чем её отсутствие. Она делается один раз и навсегда, поэтому
 * пустая заняла бы место настоящей — и возвращать оказалось бы нечего именно
 * тогда, когда понадобится.
 */
function worthSaving(contents: SnapshotContents): boolean {
  return (
    contents.settings.priorities.length > 0 ||
    Object.keys(contents.journal.clicks).length > 0 ||
    Object.keys(contents.journal.battery).length > 0 ||
    Object.keys(contents.skillClicks).length > 0
  );
}

/**
 * Копия локальных данных перед первым переходом.
 *
 * Делается один раз: второй запуск уже не «до перехода», и перезаписывать ею
 * первую значило бы затереть единственное, что помнит состояние до него.
 */
export async function backupOnce(contents: SnapshotContents): Promise<void> {
  if (!worthSaving(contents)) return;
  try {
    if (await opsLog.meta(BACKUP_KEY)) return;
    await opsLog.setMeta(BACKUP_KEY, exportSnapshot(contents));
    console.info('[sync] локальная копия сохранена перед переходом на сервер');
  } catch (error) {
    console.warn('[sync] копия перед переходом не сохранилась', error);
  }
}

/** Копия, сделанная перед переходом. Для восстановления штатным parseSnapshot. */
export async function backupBeforeSync(): Promise<string | undefined> {
  const raw = await opsLog.meta(BACKUP_KEY);
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * Стоит ли вообще предлагать возврат.
 *
 * Не «есть ли копия», а «есть ли в ней то, чего сейчас нет». Разница видна
 * сразу после удачного возврата: копия никуда не делась и не денется — она
 * последнее, что помнит состояние до переезда, — но предлагать вернуть уже
 * вернувшееся значит пугать человека кнопкой, которая обещает несделанное.
 *
 * Сравнение целиком местное, без сети: те же правила, что у доливки. Поэтому
 * кнопка сама появится снова, если данные снова пропадут, и сама исчезнет,
 * когда они на месте.
 *
 * Достижения в счёт не идут: снятое вручную держало бы кнопку вечно. Вернуть
 * их возврат всё равно вернёт — вопрос лишь в том, ради чего его предлагать.
 */
export async function somethingToRestore(current: SnapshotContents): Promise<boolean> {
  const raw = await backupBeforeSync();
  if (raw === undefined) return false;

  let saved: SnapshotContents;
  try {
    saved = parseSnapshot(raw);
  } catch {
    // Копия не читается — предлагать её нечестно.
    return false;
  }

  const have: Projected = {
    journal: current.journal,
    skillClicks: current.skillClicks,
    awards: current.awards,
  };
  if (opsToFill(saved, have, () => '').some((op) => op.kind !== 'award')) return true;

  const known = new Set(current.settings.priorities.map((item) => item.id));
  return saved.settings.priorities.some((item) => !known.has(item.id));
}

/**
 * Приоритеты, на которые ссылается история, обязаны остаться в списке.
 *
 * Блок в истории — это пара «день + id приоритета». Настройки же документ
 * цельный, и побеждает один. Если у устройств разные наборы id — а они разные,
 * потому что CloudStorage никогда не работал и каждое заводило приоритеты само,
 * — то победивший список оставляет чужую историю без имён. Блоки при этом целы
 * и лежат на сервере, но на экране их нет: показать блок не к чему.
 *
 * Поэтому в список дописываются те чужие приоритеты, **на которые есть
 * ссылки**. Не весь чужой список: приоритет, которым ни разу не пользовались,
 * ничего не прячет, а лишние строки — та же потеря, только наоборот.
 */
function withReferenced(base: Settings, extra: Priority[], clicks: ClicksMap): Settings {
  const referenced = new Set<string>();
  for (const entry of Object.values(clicks)) {
    for (const [id, count] of Object.entries(entry)) if (count > 0) referenced.add(id);
  }

  const known = new Set(base.priorities.map((item) => item.id));
  const missing = extra.filter((item) => referenced.has(item.id) && !known.has(item.id));
  return missing.length === 0 ? base : { ...base, priorities: [...base.priorities, ...missing] };
}

// --- Сверка снимка с журналом ------------------------------------------------

/**
 * Снимок, поправленный тем, что принёс обмен.
 *
 * Доливка сравнивает состояние устройства с состоянием сервера и отправляет
 * туда всё, чего там нет. Пока устройство знает только своё, это верно. Но
 * обмен идёт первым и успевает принести чужое — в том числе снятия: убранный на
 * телефоне блок, удалённый переход заряда. Снимок, с которым приложение
 * открылось, про них ещё не знает, и доливка честно объявляет их «недостающим
 * на сервере» и ставит обратно — да ещё и с более свежей меткой, то есть
 * навсегда.
 *
 * Снаружи это выглядело так: отметки на компьютере и на телефоне расходятся, а
 * перезагрузка не помогает: каждое открытие воскрешало снятое заново и
 * увозило воскресшее обратно на сервер.
 *
 * Правило: где журнал за время обмена изменился, побеждает журнал. Всё
 * остальное в снимке остаётся как было — он может помнить то, чего в журнале
 * нет вовсе (перенос из прежнего хранилища, копия перед переездом), и терять
 * это нельзя.
 */
function reconciled(local: SnapshotContents, before: Projected, after: Projected): SnapshotContents {
  return {
    ...local,
    journal: {
      clicks: reconcileClicks(local.journal.clicks, before.journal.clicks, after.journal.clicks),
      battery: reconcileBattery(
        local.journal.battery,
        before.journal.battery,
        after.journal.battery,
      ),
    },
    skillClicks: reconcileClicks(local.skillClicks, before.skillClicks, after.skillClicks),
    awards: reconcileAwards(local.awards, before.awards, after.awards),
  };
}

/** Счётчики: изменившаяся за обмен ячейка берётся из журнала, остальные — из снимка. */
function reconcileClicks(mine: ClicksMap, before: ClicksMap, after: ClicksMap): ClicksMap {
  const out: ClicksMap = {};
  for (const [day, entry] of Object.entries(mine)) out[day] = { ...entry };

  for (const day of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = before[day] ?? {};
    const now = after[day] ?? {};
    for (const id of new Set([...Object.keys(was), ...Object.keys(now)])) {
      const wasCount = was[id] ?? 0;
      const nowCount = now[id] ?? 0;
      if (wasCount === nowCount) continue;
      const entry = (out[day] ??= {});
      if (nowCount > 0) entry[id] = nowCount;
      else delete entry[id];
    }
    if (out[day] !== undefined && Object.keys(out[day]!).length === 0) delete out[day];
  }
  return out;
}

/**
 * Заряд: важны только минуты, которые обмен убрал.
 *
 * Смену уровня выправлять незачем — доливка не трогает занятые минуты, у них
 * свой автор. А вот освободившуюся минуту она заняла бы заново, и удалённый на
 * другом устройстве переход вернулся бы.
 */
function reconcileBattery(
  mine: Record<DayKey, BatteryShift[]>,
  before: Record<DayKey, BatteryShift[]>,
  after: Record<DayKey, BatteryShift[]>,
): Record<DayKey, BatteryShift[]> {
  const out: Record<DayKey, BatteryShift[]> = {};
  for (const [day, shifts] of Object.entries(mine)) out[day] = [...shifts];

  for (const day of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const alive = new Set((after[day] ?? []).map((shift) => shift[0]));
    const gone = (before[day] ?? []).map((shift) => shift[0]).filter((minute) => !alive.has(minute));
    if (gone.length === 0) continue;

    const kept = (out[day] ?? []).filter((shift) => !gone.includes(shift[0]));
    if (kept.length > 0) out[day] = kept;
    else delete out[day];
  }
  return out;
}

/** Достижения: снятое за время обмена не выдаём заново. Выданное доливка и так не тронет. */
function reconcileAwards(mine: AwardMap, before: AwardMap, after: AwardMap): AwardMap {
  const out: AwardMap = { ...mine };
  for (const id of Object.keys(before)) {
    if (after[id] === undefined) delete out[id];
  }
  return out;
}

/** Объединение карт кликов — только чтобы узнать, какие id вообще встречаются. */
function bothClicks(a: ClicksMap, b: ClicksMap): ClicksMap {
  const out: ClicksMap = {};
  for (const source of [a, b]) {
    for (const [day, entry] of Object.entries(source)) out[day] = { ...out[day], ...entry };
  }
  return out;
}

/**
 * Общая часть перехода и восстановления: забрать чужое, долить своё, отдать
 * получившееся.
 *
 * Режим разделяет два случая.
 *
 * `adopt` — обычное открытие приложения. Настройки отправляются, только если на
 * сервере их ещё нет: чужие свежее наших древних. А снимок перед доливкой
 * сверяется с журналом: то, что обмен только что снял, доливать нельзя.
 *
 * `restore` — человек прямо попросил вернуть то, что было. Здесь и настройки
 * уходят всегда, и снимок берётся как есть: воскрешение — ровно то, чего просили.
 */
async function joinServer(
  local: SnapshotContents,
  stamp: Stamper,
  mode: 'adopt' | 'restore',
  deps?: EngineDeps,
): Promise<Adopted | undefined> {
  const docsAnyway = mode === 'restore';

  /*
   * Журнал до обмена. Нужен, чтобы отличить «этого на сервере никогда не было»
   * от «это только что оттуда снято»: сам снимок такого не помнит. Возврату он
   * ни к чему — там снимок и есть то, что просили вернуть.
   */
  const before = docsAnyway ? undefined : project(await readLocalBase(), await opsLog.all());

  /*
   * Сначала забираем. Считать «чего не хватает» до того, как узнали, что там
   * есть, значило бы долить лишнее — и, что хуже, перебить чужие числа своими.
   */
  const pull = await syncOnce(deps);
  if (!pull.ok) return undefined;

  const want =
    before === undefined
      ? local
      : reconciled(local, before, project(await readLocalBase(), await opsLog.all()));

  /*
   * Копия снимается здесь, а не раньше.
   *
   * Раньше значило бы «при каждой попытке», в том числе неудачной, — а попытка
   * без сети случается на первом же запуске, когда человек ещё ничего не завёл.
   * Копия делается один раз и навсегда, и такая пустая заняла бы место
   * настоящей. Содержимое при этом прочитано до всякого обмена: `local` пришёл
   * аргументом и здешним `syncOnce` не тронут.
   */
  await backupOnce(local);

  if (pull.docs.length > 0) await writeLocalDocs(pull.docs);
  const theirs = readDocs(pull.docs);

  /*
   * Чего не хватает СЕРВЕРУ, а не собственной проекции.
   *
   * Разница принципиальная и оплачена проверкой на боевой сборке. Перенесённое
   * из прежнего хранилища лежит в том же журнале, что и всё остальное, поэтому
   * разница с самим собой всегда пуста: своё так и осталось бы на устройстве, а
   * обмен бодро отчитывался бы «долито 0».
   */
  const theirsState = await serverState(deps);
  if (!theirsState) return undefined;
  const ops: Op[] = opsToFill(want, theirsState, stamp);

  /*
   * Документы решаются поштучно. Оптом было бы неверно: у сервера могут быть
   * настройки и не быть каталога навыков, и «раз настройки есть, значит всё
   * есть» оставило бы каталог на устройстве навсегда.
   */
  const seen = bothClicks(theirsState.journal.clicks, want.journal.clicks);
  const settings = docsAnyway
    ? withReferenced(local.settings, theirs.settings?.priorities ?? [], seen)
    : withReferenced(theirs.settings ?? local.settings, local.settings.priorities, seen);

  const docs: SyncDoc[] = [];
  // Список отправляется, если он наш или если мы его дополнили: молча оставить
  // дополненный только у себя значило бы, что на другом устройстве история
  // снова без имён.
  if (docsAnyway || !theirs.settings || settings !== theirs.settings) {
    docs.push(settingsDoc(settings, stamp));
  }
  if (docsAnyway || !theirs.skills) docs.push(skillsDoc(local.skills, stamp));
  // Локально те же документы с той же меткой: разойдись метки — и своя же
  // запись выглядела бы то новее, то старее самой себя.
  await writeLocalDocs(docs);

  if (ops.length > 0 || docs.length > 0) {
    if (!(await contribute(ops, docs, deps))) return undefined;
  }

  const mine = readDocs(docs);
  const projected = project(await readLocalBase(), await opsLog.all());
  return {
    ...projected,
    settings,
    skills: docsAnyway ? (mine.skills ?? theirs.skills) : (theirs.skills ?? mine.skills),
    filled: ops.length,
  };
}

/**
 * Забирает состояние с сервера, предварительно долив туда своё.
 *
 * undefined — переход не состоялся: нет сессии, нет сети или сервер не ответил.
 * Это не ошибка, а «пока работаем как работали».
 */
export async function adoptServerState(
  local: SnapshotContents,
  stamp: Stamper,
  deps?: EngineDeps,
): Promise<Adopted | undefined> {
  return joinServer(local, stamp, 'adopt', deps);
}

/**
 * Вернуть то, что было на устройстве до перехода на сервер.
 *
 * Возврат идёт доливкой, а не заменой, и это важно: если переезд успел обидеть
 * два устройства, каждое восстановит своё, и на сервере окажется объединение —
 * а не то из них, которое нажало кнопку последним.
 *
 * undefined — копии нет либо обмен не удался; в обоих случаях ничего не
 * изменилось.
 */
export async function restoreBeforeSync(
  stamp: Stamper,
  deps?: EngineDeps,
): Promise<Adopted | undefined> {
  const raw = await backupBeforeSync();
  if (raw === undefined) return undefined;

  /*
   * Перечитываем сервер с нуля. Возврат зовут, когда на устройстве что-то
   * пошло не так, и доверять курсору в этот момент нельзя: он утверждает, что
   * всё чужое уже прочитано, а журнала может не быть вовсе.
   */
  await rewindCursor();
  return joinServer(parseSnapshot(raw), stamp, 'restore', deps);
}

export type { SyncDoc };
