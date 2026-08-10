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
 * Третье: засев делается, только когда на сервере действительно пусто. «Не
 * дозвонились» — это не «пусто»: засев по догадке затёр бы чужую историю.
 */

import type { SnapshotContents } from '../domain/snapshot';
import { exportSnapshot } from '../domain/snapshot';
import { opsLog } from '../store/local/db';
import { docsFrom, readDocs, type ReadDocs } from './documents';
import { readLocalBase, writeLocalDocs } from './local';
import { seedServer, serverIsEmpty, syncOnce } from './engine';
import type { Stamper } from './ops';
import { project, type Projected } from './project';
import type { SyncDoc } from './transport';

/** Где лежит страховочная копия. Одна на устройство: делается раз, перед переходом. */
const BACKUP_KEY = 'backup:before-sync';

export interface Adopted extends Projected, ReadDocs {
  /** Сервер был пуст, и мы отправили туда своё. */
  seeded: boolean;
}

function hasHistory(contents: SnapshotContents): boolean {
  return (
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
 * Забирает состояние с сервера, при необходимости предварительно засеяв его.
 *
 * undefined — переход не состоялся: нет сессии, нет сети или сервер не ответил.
 * Это не ошибка, а «пока работаем как работали».
 */
export async function adoptServerState(
  local: SnapshotContents,
  stamp: Stamper,
): Promise<Adopted | undefined> {
  const empty = await serverIsEmpty();
  if (empty === undefined) return undefined;

  await backupOnce(local);

  let seeded = false;
  if (empty) {
    /*
     * Журнал начали вести недавно, а история копилась годами — в нём только
     * хвост. Поэтому отправляем не накопленные операции, а итоги по каждой
     * ячейке: установкой, чтобы повтор засева ничего не удвоил.
     */
    const { opsForContents } = await import('./record');
    const docs = docsFrom(local.settings, local.skills, stamp);
    // Локально те же документы с той же меткой: разойдись метки — и своя же
    // запись выглядела бы то новее, то старее самой себя.
    await writeLocalDocs(docs);
    seeded = await seedServer(opsForContents(local, stamp), docs);
    if (!seeded) return undefined;
  }

  const outcome = await syncOnce();
  if (!outcome.ok && !seeded) return undefined;

  // Пришедшие документы кладём на диск: следующий запуск должен открыться с
  // ними, даже если сети не будет вовсе.
  if (outcome.docs.length > 0) await writeLocalDocs(outcome.docs);

  // Проекция строится по всему журналу целиком, а не поверх локального
  // состояния: то же самое уже учтено в операциях засева, и сложение удвоило бы.
  const projected = project(await readLocalBase(), await opsLog.all());
  return { ...projected, ...readDocs(outcome.docs), seeded };
}

/**
 * Стоит ли вообще заводить разговор о переходе.
 *
 * Пустое устройство — новое: ему нечего терять и нечего засевать, оно просто
 * заберёт чужое. Устройство с историей — то, ради которого написана копия выше.
 */
export function worthAdopting(local: SnapshotContents): boolean {
  return hasHistory(local) || local.settings.priorities.length > 0;
}

export type { SyncDoc };
