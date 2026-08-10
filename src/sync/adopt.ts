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
import type { ClicksMap, Priority, Settings } from '../domain/types';
import { opsLog } from '../store/local/db';
import { readDocs, settingsDoc, skillsDoc, type ReadDocs } from './documents';
import { contribute, syncOnce, type EngineDeps } from './engine';
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
 * Копия локальных данных перед первым переходом.
 *
 * Делается один раз: второй запуск уже не «до перехода», и перезаписывать ею
 * первую значило бы затереть единственное, что помнит состояние до него.
 */
async function backupOnce(contents: SnapshotContents): Promise<void> {
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
 * `docsAnyway` разделяет два случая. При переходе настройки отправляются, только
 * если на сервере их ещё нет: чужие свежее наших древних. При восстановлении —
 * всегда: человек прямо попросил вернуть то, что было.
 */
async function joinServer(
  local: SnapshotContents,
  stamp: Stamper,
  docsAnyway: boolean,
  deps?: EngineDeps,
): Promise<Adopted | undefined> {
  /*
   * Сначала забираем. Считать «чего не хватает» до того, как узнали, что там
   * есть, значило бы долить лишнее — и, что хуже, перебить чужие числа своими.
   */
  const pull = await syncOnce(deps);
  if (!pull.ok) return undefined;
  if (pull.docs.length > 0) await writeLocalDocs(pull.docs);
  const theirs = readDocs(pull.docs);

  const before = project(await readLocalBase(), await opsLog.all());
  const ops: Op[] = opsToFill(local, before, stamp);

  /*
   * Документы решаются поштучно. Оптом было бы неверно: у сервера могут быть
   * настройки и не быть каталога навыков, и «раз настройки есть, значит всё
   * есть» оставило бы каталог на устройстве навсегда.
   */
  const seen = bothClicks(before.journal.clicks, local.journal.clicks);
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
  await backupOnce(local);
  return joinServer(local, stamp, false, deps);
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
  return joinServer(parseSnapshot(raw), stamp, true, deps);
}

export type { SyncDoc };
