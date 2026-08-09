/**
 * Обмен операциями с сервером.
 *
 * Устроен так, чтобы отсутствие сети было обычным состоянием, а не аварией.
 * Приложение пишет операции в локальный журнал и живёт дальше; движок при
 * случае относит накопленное и приносит чужое. Не донёс — донесёт в следующий
 * раз, ничего не потеряв: очередь отправки это просто выборка неотмеченных
 * операций из того же журнала, а не отдельный список, который может разойтись
 * с ним.
 *
 * Ни одна ошибка здесь не всплывает наверх исключением. Синхронизация —
 * удобство поверх работающего приложения, и падать из-за неё нечему.
 */

import { opsLog } from '../store/local/db';
import { ensureSession } from './auth';
import type { Op } from './ops';
import {
  TransportError,
  transport,
  type PullResult,
  type SyncDoc,
  type SyncTransport,
} from './transport';

/** Ключ курсора в служебном хранилище: докуда прочитано с сервера. */
const CURSOR_KEY = 'cursor';

/** Сколько операций отдаём за раз. Совпадает с потолком на сервере. */
const PUSH_BATCH = 500;

/** Сколько страниц подряд забираем, прежде чем отдать управление. */
const MAX_PAGES = 20;

export interface SyncOutcome {
  /** Отправлено операций. */
  pushed: number;
  /** Получено чужих операций. */
  pulled: number;
  /** Документы, пришедшие с сервера: настройки и каталог навыков. */
  docs: SyncDoc[];
  /** Обмен состоялся. false — не было сессии или сети. */
  ok: boolean;
}

const IDLE: SyncOutcome = { pushed: 0, pulled: 0, docs: [], ok: false };

async function readCursor(): Promise<number> {
  const raw = await opsLog.meta(CURSOR_KEY);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Курсор двигается только вперёд.
 *
 * Ответы могут прийти не в том порядке, в каком уходили запросы, и откат
 * курсора назад означал бы повторное вычитывание уже применённого. Само по
 * себе это безвредно — операции идемпотентны, — но трафик и время растут на
 * ровном месте.
 */
async function advanceCursor(seq: number): Promise<void> {
  if (seq <= (await readCursor())) return;
  await opsLog.setMeta(CURSOR_KEY, seq);
}

export interface EngineDeps {
  transport: SyncTransport;
  session(): Promise<{ access: string } | undefined>;
}

const REAL: EngineDeps = { transport, session: ensureSession };

/**
 * Один заход: отдать своё, забрать чужое.
 *
 * Отдаём раньше, чем забираем, намеренно. Иначе своя же операция вернётся
 * следующим чтением как чужая — идемпотентность спасёт от порчи данных, но
 * лишний круг по сети случится на каждом заходе.
 */
export async function syncOnce(deps: EngineDeps = REAL, docs: SyncDoc[] = []): Promise<SyncOutcome> {
  if (!deps.transport.configured) return IDLE;

  const session = await deps.session();
  if (!session) return IDLE;

  try {
    const pushed = await pushPending(deps, session.access, docs);
    const pulled = await pullAll(deps, session.access);
    return { pushed, pulled: pulled.ops.length, docs: pulled.docs, ok: true };
  } catch (error) {
    if (error instanceof TransportError && error.status === 0) {
      // Сети нет — это не отказ, а «в другой раз». Молча.
      return IDLE;
    }
    console.warn('[sync] обмен не удался', error);
    return IDLE;
  }
}

async function pushPending(deps: EngineDeps, access: string, docs: SyncDoc[] = []): Promise<number> {
  const pending = await opsLog.pending();
  if (pending.length === 0 && docs.length === 0) return 0;

  // Документам нужен хотя бы один запрос, даже если операций нет вовсе:
  // переименовать приоритет, ничего не отметив, — обычное дело.
  if (pending.length === 0) {
    await deps.transport.push(access, [], docs);
    return 0;
  }

  let sent = 0;
  for (let from = 0; from < Math.max(pending.length, 1); from += PUSH_BATCH) {
    const batch = pending.slice(from, from + PUSH_BATCH);
    if (batch.length === 0 && from > 0) break;

    // Документы едут с первой пачкой: они маленькие и их всего два.
    const result = await deps.transport.push(access, batch, from === 0 ? docs : []);
    if (result.rejected > 0) {
      // Сервер отбраковал то, что наши проверки пропустили. Это расхождение
      // правил, а не сбой сети, и молчать о нём нельзя.
      console.warn(`[sync] сервер отбраковал операций: ${result.rejected}`);
    }

    /*
     * Отметка о доставке ставится только после ответа сервера. Упади запрос
     * посередине — операции останутся в очереди и уйдут снова; повтор безвреден,
     * потеря нет.
     */
    await opsLog.markSynced(batch);
    sent += batch.length;
    if (batch.length < PUSH_BATCH) break;
  }
  return sent;
}

/** Читает страницами, пока сервер не скажет, что больше нечего. */
async function pullAll(deps: EngineDeps, access: string): Promise<{ ops: Op[]; docs: SyncDoc[] }> {
  const ops: Op[] = [];
  let docs: SyncDoc[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const cursor = await readCursor();
    const result: PullResult =
      cursor === 0
        ? await deps.transport.bootstrap(access)
        : await deps.transport.pull(access, cursor);

    if (result.ops.length > 0) {
      /*
       * Пришедшее кладём в тот же журнал сразу доставленным: оно уже на
       * сервере, отправлять его обратно незачем. Повтор по opId журнал
       * отсекает сам, поэтому своя же операция, вернувшаяся с сервера, ничего
       * не портит.
       */
      await opsLog.append(result.ops, 1);
      ops.push(...result.ops);
    }
    if (result.docs.length > 0) docs = result.docs;

    await advanceCursor(result.seq);
    if (!result.more) break;
  }

  return { ops, docs };
}

/**
 * Отправка состояния целиком: барьер и итоги по каждой ячейке.
 *
 * Нужна ровно один раз — когда на сервере ещё пусто, а на устройстве уже есть
 * история. Операциями её не выразить: журнал начали вести недавно, а история
 * копилась годами, и в нём лежит только хвост.
 */
export async function seedServer(
  ops: Op[],
  docs: SyncDoc[],
  deps: EngineDeps = REAL,
): Promise<boolean> {
  if (!deps.transport.configured) return false;
  const session = await deps.session();
  if (!session) return false;

  try {
    await opsLog.clear();
    await opsLog.append(ops);
    await pushPending(deps, session.access, docs);
    return true;
  } catch (error) {
    console.warn('[sync] засев сервера не удался', error);
    return false;
  }
}

/** Пусто ли на сервере. Отвечает на единственный вопрос: нужен ли засев. */
export async function serverIsEmpty(deps: EngineDeps = REAL): Promise<boolean | undefined> {
  if (!deps.transport.configured) return undefined;
  const session = await deps.session();
  if (!session) return undefined;

  try {
    const result = await deps.transport.bootstrap(session.access);
    return result.ops.length === 0 && result.docs.length === 0;
  } catch {
    // Не узнали — значит, не знаем. Засев по догадке хуже отложенного засева.
    return undefined;
  }
}
