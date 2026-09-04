/**
 * Локальный дом для документов и курсора.
 *
 * Операции лежат в своём хранилище, а настройки и каталог навыков — документы:
 * они меняются целиком и сравниваются метками. До сих пор их домом был
 * CloudStorage, но он перестаёт быть источником истины, и держать их там значит
 * читать вчерашнее. Поэтому они переезжают в ту же базу, что и журнал.
 *
 * Метка хранится рядом со значением намеренно. Без неё документ, пришедший с
 * сервера, нельзя отличить от более свежей своей правки, ещё не уехавшей, — и
 * сеть откатывала бы то, что человек только что поменял.
 */

import { opsLog } from '../store/local/db';
import { readDocs, type ReadDocs } from './documents';
import { emptyBase, type Base } from './project';
import type { SyncDoc, SyncSnapshot } from './transport';

const KEY = (kind: SyncDoc['kind']): string => `doc:${kind}`;

/**
 * Отметка «журнал здесь главный».
 *
 * Именно отметка, а не «журнал непуст». После «стереть всё» журнал пуст
 * законно, и по пустоте приложение решило бы, что переезда не было, — и
 * подняло бы из прежнего хранилища ровно то, что человек только что стёр.
 */
const READY_KEY = 'oplog:ready';

export async function isMigrated(): Promise<boolean> {
  return Boolean(await opsLog.meta(READY_KEY));
}

export async function markMigrated(): Promise<void> {
  await opsLog.setMeta(READY_KEY, 1);
}

function sanitize(raw: unknown): SyncDoc | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Partial<SyncDoc>;
  if (value.kind !== 'settings' && value.kind !== 'skills') return undefined;
  if (typeof value.body !== 'string' || !value.body) return undefined;
  return { kind: value.kind, body: value.body, hlc: typeof value.hlc === 'string' ? value.hlc : '' };
}

/**
 * Свёрнутая часть истории.
 *
 * Сервер убирает старые операции, заменяя их месячным итогом, — и без этих
 * снимков устройство увидело бы только хвост. Хранятся они рядом с журналом и
 * служат основанием проекции: сначала снимки, поверх них операции.
 */
const SNAPSHOTS_KEY = 'snapshots';

export async function readLocalBase(): Promise<Base> {
  return baseFrom((await opsLog.meta(SNAPSHOTS_KEY)) as SyncSnapshot[] | undefined);
}

/** Снимки сервера в основание проекции. Отдельно от чтения — их же надо разобрать и не с диска. */
export function baseFrom(raw: SyncSnapshot[] | undefined): Base {
  const base = emptyBase();
  if (!Array.isArray(raw)) return base;

  for (const item of raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(item.body);
    } catch {
      console.warn(`[sync] снимок ${item.scope} ${item.month} не читается`);
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;

    if (item.scope === 'clicks') Object.assign(base.clicks, parsed);
    else if (item.scope === 'skills') Object.assign(base.skillClicks, parsed);
    else Object.assign(base.battery, parsed);
  }
  return base;
}

/**
 * Снимки заменяются целиком, а не дописываются.
 *
 * Сервер отдаёт их полным набором, и слияние по месяцам скрыло бы удаление:
 * стёртый месяц остался бы у устройства навсегда.
 */
export async function writeLocalBase(snapshots: SyncSnapshot[]): Promise<void> {
  await opsLog.setMeta(SNAPSHOTS_KEY, snapshots);
}

export async function readLocalDocs(): Promise<ReadDocs> {
  const stored: SyncDoc[] = [];
  for (const kind of ['settings', 'skills'] as const) {
    const doc = sanitize(await opsLog.meta(KEY(kind)));
    if (doc) stored.push(doc);
  }
  return readDocs(stored);
}

/** Есть ли здесь вообще документы. Отвечает на вопрос «мы уже переезжали?». */
export async function hasLocalDocs(): Promise<boolean> {
  return sanitize(await opsLog.meta(KEY('settings'))) !== undefined;
}

/**
 * Кладёт документы, если они новее уже лежащих.
 *
 * Побеждает большая метка — то же правило, что и на сервере. Иначе пришедшее
 * по сети затирало бы свежую местную правку просто потому, что пришло позже.
 *
 * Отвечает тем, что действительно легло. Сервер отдаёт документы при каждом
 * чтении, и без этого ответа обмен не мог бы отличить «пришло чужое, надо
 * показать» от «пришло то же самое, что и лежало».
 */
export async function writeLocalDocs(docs: SyncDoc[]): Promise<SyncDoc[]> {
  const written: SyncDoc[] = [];
  for (const doc of docs) {
    const current = sanitize(await opsLog.meta(KEY(doc.kind)));
    if (current && current.hlc >= doc.hlc) continue;
    await opsLog.setMeta(KEY(doc.kind), doc);
    written.push(doc);
  }
  return written;
}
