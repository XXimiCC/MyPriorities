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
import type { SyncDoc } from './transport';

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
 */
export async function writeLocalDocs(docs: SyncDoc[]): Promise<void> {
  for (const doc of docs) {
    const current = sanitize(await opsLog.meta(KEY(doc.kind)));
    if (current && current.hlc >= doc.hlc) continue;
    await opsLog.setMeta(KEY(doc.kind), doc);
  }
}
