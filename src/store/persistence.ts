/**
 * Схема хранения и сериализация.
 *
 * CloudStorage даёт 4096 символов на значение, поэтому история режется по
 * месяцам, а клики и батарея лежат в разных ключах. Внутри месяца дни —
 * это `01`..`31`, а приоритеты адресуются короткими стабильными id: месяц с
 * десятью активными приоритетами укладывается примерно в 2.2 КБ, вдвое ниже лимита.
 *
 * Позиционные массивы вместо id использовать нельзя: добавление или удаление
 * приоритета переписало бы задним числом всю историю.
 */

import { store, VALUE_LIMIT } from '../telegram/cloudStorage';
import { composeDayKey, dayOfMonth, monthKey, recentMonths } from '../domain/date';
import { DEFAULT_PRIORITIES } from '../domain/presets';
import type {
  BatteryLevel,
  BatteryShift,
  DayClicks,
  DayKey,
  Journal,
  Priority,
  Settings,
} from '../domain/types';
import { DEFAULT_BLOCK_MINUTES, MAX_PRIORITIES } from '../domain/types';
import type { StringKey } from '../i18n';

const KEY_SETTINGS = 'mp:s';
const keyClicks = (month: string): string => `mp:p:${month}`;
const keyBattery = (month: string): string => `mp:b:${month}`;

/** Сколько месяцев истории держим. Дальше — чистим, чтобы не упереться в лимит ключей. */
export const RETENTION_MONTHS = 13;

/** Архив нужен только ради подписей в статистике, поэтому он ограничен. */
const MAX_ARCHIVED = 40;

// --- Идентификаторы ----------------------------------------------------------

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Двухсимвольный id: короткий, потому что он повторяется в каждом дне истории. */
export function newPriorityId(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let length = 2; length <= 4; length += 1) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      let id = '';
      for (let i = 0; i < length; i += 1) {
        id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
      }
      if (!used.has(id)) return id;
    }
  }
  return `x${Date.now().toString(36)}`;
}

// --- Настройки ---------------------------------------------------------------

export function emptySettings(): Settings {
  return {
    version: 1,
    priorities: [],
    archived: [],
    onboarded: false,
    blockMinutes: DEFAULT_BLOCK_MINUTES,
  };
}

/** Разворачивает пресет или список названий в приоритеты, переиспользуя уже известные id. */
export function materialize(
  source: Array<{ title: string; colorId: number }>,
  known: Priority[],
): Priority[] {
  const byTitle = new Map(known.map((p) => [p.title.trim().toLowerCase(), p]));
  const taken = new Set(known.map((p) => p.id));
  const out: Priority[] = [];

  for (const item of source.slice(0, MAX_PRIORITIES)) {
    // Совпадение по названию сохраняет историю: «Работа» из одного набора и из
    // другого — это один и тот же приоритет, а не два разных с нуля.
    const existing = byTitle.get(item.title.trim().toLowerCase());
    const id = existing?.id ?? newPriorityId(taken);
    taken.add(id);
    out.push({ id, title: item.title, colorId: item.colorId });
  }
  return out;
}

export function defaultSettings(): Settings {
  const base = emptySettings();
  return { ...base, priorities: materialize(DEFAULT_PRIORITIES, []) };
}

function sanitizeSettings(raw: unknown): Settings | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Partial<Settings>;
  if (!Array.isArray(value.priorities)) return undefined;

  const seen = new Set<string>();
  const clean = (list: unknown): Priority[] =>
    (Array.isArray(list) ? list : [])
      .filter((p): p is Priority =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as Priority).id === 'string' &&
        typeof (p as Priority).title === 'string',
      )
      .filter((p) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      })
      .map((p) => ({ id: p.id, title: p.title, colorId: Number(p.colorId) || 0 }));

  const priorities = clean(value.priorities).slice(0, MAX_PRIORITIES);
  const blockMinutes = Number(value.blockMinutes);
  return {
    version: 1,
    priorities,
    archived: clean(value.archived).slice(-MAX_ARCHIVED),
    presetId: typeof value.presetId === 'string' ? value.presetId : undefined,
    onboarded: Boolean(value.onboarded) || priorities.length > 0,
    // Настройки, записанные до появления этого поля, читаются как значение по умолчанию.
    blockMinutes: Number.isFinite(blockMinutes) && blockMinutes > 0 ? blockMinutes : DEFAULT_BLOCK_MINUTES,
  };
}

export async function loadSettings(): Promise<Settings | undefined> {
  const raw = await store.get([KEY_SETTINGS]);
  const value = raw[KEY_SETTINGS];
  if (!value) return undefined;
  try {
    return sanitizeSettings(JSON.parse(value));
  } catch {
    console.warn('[persistence] настройки повреждены, начинаем заново');
    return undefined;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const trimmed: Settings = { ...settings, archived: settings.archived.slice(-MAX_ARCHIVED) };
  const payload = JSON.stringify(trimmed);
  if (payload.length > VALUE_LIMIT) {
    // До этого можно дойти только очень длинными названиями — режем архив целиком.
    await store.set(KEY_SETTINGS, JSON.stringify({ ...trimmed, archived: [] }));
    return;
  }
  await store.set(KEY_SETTINGS, payload);
}

// --- Журнал ------------------------------------------------------------------

type ClicksMonth = Record<string, DayClicks>;
type BatteryMonth = Record<string, BatteryShift[]>;

export function serializeClicksMonth(journal: Journal, month: string): string {
  const out: ClicksMonth = {};
  for (const [day, entry] of Object.entries(journal.clicks)) {
    if (monthKey(day) !== month) continue;
    const clean: DayClicks = {};
    for (const [id, count] of Object.entries(entry)) {
      if (count > 0) clean[id] = count;
    }
    if (Object.keys(clean).length > 0) out[dayOfMonth(day)] = clean;
  }
  return JSON.stringify(out);
}

export function serializeBatteryMonth(journal: Journal, month: string): string {
  const out: BatteryMonth = {};
  for (const [day, shifts] of Object.entries(journal.battery)) {
    if (monthKey(day) !== month || shifts.length === 0) continue;
    out[dayOfMonth(day)] = shifts;
  }
  return JSON.stringify(out);
}

function parseClicksMonth(month: string, raw: string, into: Journal): void {
  const parsed = JSON.parse(raw) as ClicksMonth;
  for (const [day, entry] of Object.entries(parsed)) {
    if (!entry || typeof entry !== 'object') continue;
    const clean: DayClicks = {};
    for (const [id, count] of Object.entries(entry)) {
      const n = Number(count);
      if (Number.isFinite(n) && n > 0) clean[id] = Math.floor(n);
    }
    if (Object.keys(clean).length > 0) into.clicks[composeDayKey(month, day)] = clean;
  }
}

function parseBatteryMonth(month: string, raw: string, into: Journal): void {
  const parsed = JSON.parse(raw) as BatteryMonth;
  for (const [day, shifts] of Object.entries(parsed)) {
    if (!Array.isArray(shifts)) continue;
    const clean = shifts
      .filter(
        (s): s is BatteryShift =>
          Array.isArray(s) && s.length === 2 && Number.isFinite(s[0]) && [1, 2, 3, 4].includes(s[1]),
      )
      .map((s): BatteryShift => [Math.max(0, Math.min(1440, Math.floor(s[0]))), s[1] as BatteryLevel])
      .sort((a, b) => a[0] - b[0]);
    if (clean.length > 0) into.battery[composeDayKey(month, day)] = clean;
  }
}

export function emptyJournal(): Journal {
  return { clicks: {}, battery: {} };
}

/** Читает указанные месяцы одним запросом — CloudStorage берёт список ключей разом. */
export async function loadJournal(months: string[]): Promise<Journal> {
  const journal = emptyJournal();
  if (months.length === 0) return journal;

  const keys = months.flatMap((month) => [keyClicks(month), keyBattery(month)]);
  const values = await store.get(keys);

  for (const month of months) {
    const clicks = values[keyClicks(month)];
    const battery = values[keyBattery(month)];
    try {
      if (clicks) parseClicksMonth(month, clicks, journal);
    } catch {
      console.warn(`[persistence] испорчен блок кликов ${month}`);
    }
    try {
      if (battery) parseBatteryMonth(month, battery, journal);
    } catch {
      console.warn(`[persistence] испорчен блок батареи ${month}`);
    }
  }
  return journal;
}

export async function saveClicksMonth(journal: Journal, month: string): Promise<void> {
  await store.set(keyClicks(month), serializeClicksMonth(journal, month));
}

export async function saveBatteryMonth(journal: Journal, month: string): Promise<void> {
  await store.set(keyBattery(month), serializeBatteryMonth(journal, month));
}

const MONTH_KEY_PATTERN = /^mp:[pb]:(\d{4}-\d{2})$/;

/** Удаляет блоки старше горизонта хранения. Ошибки глушим — это уборка, а не критический путь. */
export async function pruneOldMonths(now: Date = new Date()): Promise<void> {
  try {
    const keep = new Set(recentMonths(RETENTION_MONTHS, now));
    const all = await store.keys();
    const stale = all.filter((key) => {
      const match = MONTH_KEY_PATTERN.exec(key);
      return match && !keep.has(match[1]!);
    });
    if (stale.length > 0) await store.remove(stale);
  } catch (error) {
    console.warn('[persistence] уборка старых месяцев не удалась', error);
  }
}

/**
 * Сносит всю историю кликов и батареи. Список приоритетов не трогает —
 * это разные по смыслу операции: обнулить счётчики и начать кабинет заново.
 *
 * Удаляются именно ключи, а не записывается пустой объект: иначе в облаке
 * останутся месяцы, которых нет в памяти, и следующая загрузка их вернёт.
 */
export async function clearHistory(): Promise<void> {
  const all = await store.keys();
  const months = all.filter((key) => MONTH_KEY_PATTERN.test(key));
  if (months.length > 0) await store.remove(months);
}

/** Полный сброс кабинета: история, приоритеты, настройки. */
export async function clearEverything(): Promise<void> {
  await clearHistory();
  await store.remove([KEY_SETTINGS]);
}

export interface Snapshot {
  app: 'my-priorities';
  version: 1;
  exportedAt: string;
  settings: Settings;
  journal: Journal;
}

/** Выгрузка всех данных: сброс необратим, поэтому копию надо уметь забрать заранее. */
export function exportSnapshot(settings: Settings, journal: Journal, now: Date = new Date()): string {
  const snapshot: Snapshot = {
    app: 'my-priorities',
    version: 1,
    exportedAt: now.toISOString(),
    settings,
    journal,
  };
  return JSON.stringify(snapshot, null, 2);
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ошибка разбора копии несёт ключ строки, а не готовый текст: сообщение
 * показывается пользователю, значит его должен переводить тот, кто рисует,
 * а не слой хранения.
 */
export class SnapshotError extends Error {
  constructor(readonly key: StringKey) {
    super(key);
    this.name = 'SnapshotError';
  }
}

/**
 * Разбор копии. Чужой или битый файл должен упасть с внятным сообщением,
 * а не втихую подменить данные пустышкой — восстановление делается ровно тогда,
 * когда терять уже нечего.
 */
export function parseSnapshot(json: string): { settings: Settings; journal: Journal } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new SnapshotError('import.notJson');
  }

  const snapshot = raw as Partial<Snapshot>;
  if (snapshot?.app !== 'my-priorities') {
    throw new SnapshotError('import.foreignFile');
  }

  const settings = sanitizeSettings(snapshot.settings);
  if (!settings || settings.priorities.length === 0) {
    throw new SnapshotError('import.noPriorities');
  }

  const journal = emptyJournal();
  const source = (snapshot.journal ?? {}) as Partial<Journal>;

  for (const [day, entry] of Object.entries(source.clicks ?? {})) {
    if (!DAY_KEY.test(day) || !entry || typeof entry !== 'object') continue;
    const clean: DayClicks = {};
    for (const [id, count] of Object.entries(entry)) {
      const n = Number(count);
      if (Number.isFinite(n) && n > 0) clean[id] = Math.floor(n);
    }
    if (Object.keys(clean).length > 0) journal.clicks[day] = clean;
  }

  for (const [day, shifts] of Object.entries(source.battery ?? {})) {
    if (!DAY_KEY.test(day) || !Array.isArray(shifts)) continue;
    const clean = shifts
      .filter(
        (s): s is BatteryShift =>
          Array.isArray(s) && s.length === 2 && Number.isFinite(s[0]) && [1, 2, 3, 4].includes(s[1]),
      )
      .map((s): BatteryShift => [Math.max(0, Math.min(1440, Math.floor(s[0]))), s[1] as BatteryLevel])
      .sort((a, b) => a[0] - b[0]);
    if (clean.length > 0) journal.battery[day] = clean;
  }

  return { settings, journal };
}

/** Записывает состояние целиком: настройки и все месяцы, что есть в журнале. */
export async function writeAll(settings: Settings, journal: Journal): Promise<void> {
  await saveSettings(settings);
  const months = new Set([
    ...Object.keys(journal.clicks).map(monthKey),
    ...Object.keys(journal.battery).map(monthKey),
  ]);
  for (const month of months) {
    await saveClicksMonth(journal, month);
    await saveBatteryMonth(journal, month);
  }
}

/** Месяцы, которые нужно держать в памяти: горизонт хранения целиком. */
export function monthsToLoad(now: Date = new Date()): string[] {
  return recentMonths(RETENTION_MONTHS, now);
}

export type { DayKey };
