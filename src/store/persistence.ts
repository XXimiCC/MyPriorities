/**
 * Схема хранения и сериализация.
 *
 * CloudStorage даёт 4096 символов на значение, поэтому история режется по
 * месяцам, а клики, батарея и навыки лежат в разных ключах. Внутри месяца дни —
 * это `01`..`31`, а приоритеты адресуются короткими стабильными id: месяц с
 * десятью активными приоритетами укладывается примерно в 2.2 КБ, вдвое ниже лимита.
 *
 * Позиционные массивы вместо id использовать нельзя: добавление или удаление
 * приоритета переписало бы задним числом всю историю.
 */

import { localMirror, store, VALUE_LIMIT } from '../telegram/cloudStorage';
import { composeDayKey, dayOfMonth, monthKey, recentMonths } from '../domain/date';
import { DEFAULT_PRIORITIES } from '../domain/presets';
import type {
  BatteryLevel,
  BatteryShift,
  ClicksMap,
  DayClicks,
  DayKey,
  Journal,
  Priority,
  Settings,
} from '../domain/types';
import { DEFAULT_BLOCK_MINUTES, DEFAULT_MODULES, MAX_PRIORITIES, sanitizeModules } from '../domain/types';
import type { Skill, SkillsState } from '../skills/types';
import { MAX_ARCHIVED_SKILLS, MAX_SKILLS, MAX_SKILL_TITLE, emptySkills } from '../skills/types';
import type { StringKey } from '../i18n';

const KEY_SETTINGS = 'mp:s';
/** Каталог навыков. Без даты, поэтому под месячный шаблон не попадает и историей не считается. */
const KEY_SKILLS = 'mp:k';
const KEY_ACHIEVEMENTS = 'mp:a';
const keyClicks = (month: string): string => `mp:p:${month}`;
const keyBattery = (month: string): string => `mp:b:${month}`;
const keySkillClicks = (month: string): string => `mp:k:${month}`;

/** Сколько месяцев истории держим. Дальше — чистим, чтобы не упереться в лимит ключей. */
export const RETENTION_MONTHS = 13;

/** Архив нужен только ради подписей в статистике, поэтому он ограничен. */
const MAX_ARCHIVED = 40;

// --- Идентификаторы ----------------------------------------------------------

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Двухсимвольный id: короткий, потому что он повторяется в каждом дне истории. */
export function newShortId(taken: Iterable<string>): string {
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
    modules: { ...DEFAULT_MODULES },
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
    const id = existing?.id ?? newShortId(taken);
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
    modules: sanitizeModules(value.modules),
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

/**
 * Один месяц кликов в строку. Форма общая для приоритетов и навыков:
 * различаются только ключ в хранилище и набор id внутри.
 */
export function serializeClicksMap(clicks: ClicksMap, month: string): string {
  const out: ClicksMonth = {};
  for (const [day, entry] of Object.entries(clicks)) {
    if (monthKey(day) !== month) continue;
    const clean: DayClicks = {};
    for (const [id, count] of Object.entries(entry)) {
      if (count > 0) clean[id] = count;
    }
    if (Object.keys(clean).length > 0) out[dayOfMonth(day)] = clean;
  }
  return JSON.stringify(out);
}

export function serializeClicksMonth(journal: Journal, month: string): string {
  return serializeClicksMap(journal.clicks, month);
}

export function serializeBatteryMonth(journal: Journal, month: string): string {
  const out: BatteryMonth = {};
  for (const [day, shifts] of Object.entries(journal.battery)) {
    if (monthKey(day) !== month || shifts.length === 0) continue;
    out[dayOfMonth(day)] = shifts;
  }
  return JSON.stringify(out);
}

function parseClicksMap(month: string, raw: string, into: ClicksMap): void {
  const parsed = JSON.parse(raw) as ClicksMonth;
  for (const [day, entry] of Object.entries(parsed)) {
    if (!entry || typeof entry !== 'object') continue;
    const clean: DayClicks = {};
    for (const [id, count] of Object.entries(entry)) {
      const n = Number(count);
      if (Number.isFinite(n) && n > 0) clean[id] = Math.floor(n);
    }
    if (Object.keys(clean).length > 0) into[composeDayKey(month, day)] = clean;
  }
}

function parseClicksMonth(month: string, raw: string, into: Journal): void {
  parseClicksMap(month, raw, into.clicks);
}

/**
 * Приводит переходы заряда к валидному виду.
 *
 * Третий элемент — id приоритета, который посадил батарею, — необязателен:
 * записи, сделанные до появления этого вопроса, читаются без миграции.
 */
function sanitizeShifts(raw: unknown): BatteryShift[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (s): s is [number, BatteryLevel] | [number, BatteryLevel, unknown] =>
        Array.isArray(s) &&
        s.length >= 2 &&
        Number.isFinite(s[0]) &&
        [1, 2, 3, 4].includes(s[1] as number),
    )
    .map((s): BatteryShift => {
      const minute = Math.max(0, Math.min(1440, Math.floor(s[0])));
      const level = s[1] as BatteryLevel;
      const drainedBy = s[2];
      return typeof drainedBy === 'string' && drainedBy.length > 0
        ? [minute, level, drainedBy]
        : [minute, level];
    })
    .sort((a, b) => a[0] - b[0]);
}

function parseBatteryMonth(month: string, raw: string, into: Journal): void {
  const parsed = JSON.parse(raw) as BatteryMonth;
  for (const [day, shifts] of Object.entries(parsed)) {
    const clean = sanitizeShifts(shifts);
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

/**
 * Значение сверх лимита CloudStorage не запишется, но и ошибку вернёт не всегда:
 * молчаливо потерянный месяц хуже, чем месяц, о потере которого сказано в консоли.
 * Наступить на это можно только синтетическими данными — реальный месяц вдвое меньше.
 */
async function setChecked(key: string, payload: string): Promise<void> {
  if (payload.length > VALUE_LIMIT) {
    console.warn(`[persistence] ${key} не помещается в лимит (${payload.length}), запись пропущена`);
    return;
  }
  await store.set(key, payload);
}

export async function saveClicksMonth(journal: Journal, month: string): Promise<void> {
  await setChecked(keyClicks(month), serializeClicksMonth(journal, month));
}

export async function saveBatteryMonth(journal: Journal, month: string): Promise<void> {
  await setChecked(keyBattery(month), serializeBatteryMonth(journal, month));
}

// --- Навыки ------------------------------------------------------------------

/**
 * Каталог навыков лежит в компактной форме: однобуквенные имена полей экономят
 * около трети объёма, а запас до лимита при двенадцати активных и двенадцати
 * архивных навыках вырастает с 11 % до 45 %. Приём тот же, что и в месячных
 * блоках, где день — это «01», а не «2026-07-01».
 */
interface StoredSkill {
  i: string;
  t: string;
  c: number;
  b: number;
  y: number;
  p?: string;
  d?: string;
}

interface StoredSkills {
  v: 1;
  s: StoredSkill[];
  a: StoredSkill[];
  f?: string;
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function packSkill(skill: Skill): StoredSkill {
  const out: StoredSkill = {
    i: skill.id,
    t: skill.title,
    c: skill.colorId,
    b: skill.baseMinutes,
    y: skill.carryBlocks,
  };
  // Необязательные поля не пишутся вовсе: undefined JSON.stringify выбрасывает сам.
  if (skill.linkedPriorityId) out.p = skill.linkedPriorityId;
  if (skill.startedOn) out.d = skill.startedOn;
  return out;
}

/** Компактная запись разворачивается в обычную и дальше проверяется общей проверкой. */
function expandSkill(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const value = raw as Partial<StoredSkill>;
  return {
    id: value.i,
    title: value.t,
    colorId: value.c,
    baseMinutes: value.b,
    carryBlocks: value.y,
    linkedPriorityId: value.p,
    startedOn: value.d,
  };
}

export function serializeSkills(state: SkillsState): string {
  const stored: StoredSkills = {
    v: 1,
    s: state.skills.slice(0, MAX_SKILLS).map(packSkill),
    a: state.archived.slice(-MAX_ARCHIVED_SKILLS).map(packSkill),
    ...(state.foldedThrough ? { f: state.foldedThrough } : {}),
  };
  return JSON.stringify(stored);
}

function cleanSkill(raw: unknown, seen: Set<string>): Skill | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Partial<Skill>;
  if (typeof value.id !== 'string' || !value.id) return undefined;
  if (typeof value.title !== 'string') return undefined;
  if (seen.has(value.id)) return undefined;
  seen.add(value.id);

  const base = Number(value.baseMinutes);
  const carry = Number(value.carryBlocks);
  return {
    id: value.id,
    title: value.title.slice(0, MAX_SKILL_TITLE),
    colorId: Number(value.colorId) || 0,
    baseMinutes: Number.isFinite(base) && base > 0 ? Math.floor(base) : 0,
    carryBlocks: Number.isFinite(carry) && carry > 0 ? Math.floor(carry) : 0,
    ...(typeof value.linkedPriorityId === 'string' && value.linkedPriorityId
      ? { linkedPriorityId: value.linkedPriorityId }
      : {}),
    ...(typeof value.startedOn === 'string' && DAY_PATTERN.test(value.startedOn)
      ? { startedOn: value.startedOn }
      : {}),
  };
}

/**
 * Разбор каталога в его обычном виде — так навыки лежат в копии данных, которую
 * человек может открыть и прочитать. Компактная форма нужна только хранилищу.
 *
 * Инвариант «один приоритет кормит не больше одного навыка» чинится именно
 * здесь: две привязки к одному приоритету означали бы, что одни и те же часы
 * засчитаны дважды, и такое лучше поправить молча, чем показать.
 */
export function sanitizeSkills(raw: unknown): SkillsState {
  if (typeof raw !== 'object' || raw === null) return emptySkills();
  const value = raw as Partial<SkillsState>;

  // Список общий: один навык не может быть одновременно активным и архивным.
  const seen = new Set<string>();
  const clean = (list: unknown): Skill[] =>
    (Array.isArray(list) ? list : [])
      .map((item) => cleanSkill(item, seen))
      .filter((item): item is Skill => item !== undefined);

  const skills = clean(value.skills).slice(0, MAX_SKILLS);
  const linked = new Set<string>();
  for (const skill of skills) {
    if (!skill.linkedPriorityId) continue;
    if (linked.has(skill.linkedPriorityId)) delete skill.linkedPriorityId;
    else linked.add(skill.linkedPriorityId);
  }

  return {
    skills,
    // У архивных навыков привязка бессмысленна: они ничего не считают.
    archived: clean(value.archived)
      .slice(-MAX_ARCHIVED_SKILLS)
      .map(({ linkedPriorityId: _drop, ...rest }) => rest),
    ...(typeof value.foldedThrough === 'string' && MONTH_PATTERN.test(value.foldedThrough)
      ? { foldedThrough: value.foldedThrough }
      : {}),
  };
}

/** Разбор компактной записи из хранилища. */
export function parseStoredSkills(raw: unknown): SkillsState {
  if (typeof raw !== 'object' || raw === null) return emptySkills();
  const value = raw as Partial<StoredSkills>;
  return sanitizeSkills({
    skills: Array.isArray(value.s) ? value.s.map(expandSkill) : [],
    archived: Array.isArray(value.a) ? value.a.map(expandSkill) : [],
    foldedThrough: value.f,
  });
}

export async function loadSkills(): Promise<SkillsState> {
  const raw = await store.get([KEY_SKILLS]);
  return readSkills(raw[KEY_SKILLS]);
}

function readSkills(value: string | undefined): SkillsState {
  if (!value) return emptySkills();
  try {
    return parseStoredSkills(JSON.parse(value));
  } catch {
    console.warn('[persistence] каталог навыков повреждён, начинаем заново');
    return emptySkills();
  }
}

export async function saveSkills(state: SkillsState): Promise<void> {
  const payload = serializeSkills(state);
  if (payload.length > VALUE_LIMIT) {
    // Дойти сюда можно только очень длинными названиями — режем архив целиком,
    // ровно как в настройках: активные навыки важнее забытых.
    await store.set(KEY_SKILLS, serializeSkills({ ...state, archived: [] }));
    return;
  }
  await store.set(KEY_SKILLS, payload);
}

export async function loadSkillClicks(months: string[]): Promise<ClicksMap> {
  const clicks: ClicksMap = {};
  if (months.length === 0) return clicks;

  const values = await store.get(months.map(keySkillClicks));
  for (const month of months) {
    const raw = values[keySkillClicks(month)];
    try {
      if (raw) parseClicksMap(month, raw, clicks);
    } catch {
      console.warn(`[persistence] испорчен блок навыков ${month}`);
    }
  }
  return clicks;
}

export async function saveSkillsMonth(clicks: ClicksMap, month: string): Promise<void> {
  await setChecked(keySkillClicks(month), serializeClicksMap(clicks, month));
}

// --- Достижения --------------------------------------------------------------

/** Полученные достижения: id → день выдачи. Хранится плоско, это уже минимальная форма. */
export type AwardMap = Record<string, DayKey>;

export function sanitizeAwards(raw: unknown): AwardMap {
  if (typeof raw !== 'object' || raw === null) return {};
  const source = (raw as { g?: unknown }).g;
  if (typeof source !== 'object' || source === null) return {};

  const out: AwardMap = {};
  for (const [id, day] of Object.entries(source as Record<string, unknown>)) {
    if (typeof day === 'string' && DAY_PATTERN.test(day)) out[id] = day;
  }
  return out;
}

export async function loadAwards(): Promise<AwardMap> {
  const raw = await store.get([KEY_ACHIEVEMENTS]);
  return readAwards(raw[KEY_ACHIEVEMENTS]);
}

function readAwards(value: string | undefined): AwardMap {
  if (!value) return {};
  try {
    return sanitizeAwards(JSON.parse(value));
  } catch {
    console.warn('[persistence] достижения повреждены, начинаем заново');
    return {};
  }
}

export function serializeAwards(awards: AwardMap): string {
  return JSON.stringify({ v: 1, g: awards });
}

export async function saveAwards(awards: AwardMap): Promise<void> {
  await setChecked(KEY_ACHIEVEMENTS, serializeAwards(awards));
}

/**
 * Что считается историей и стирается вместе с ней. Каталог навыков `mp:k` и
 * достижения `mp:a` сюда не попадают намеренно: у них нет даты, и они переживают
 * «стереть историю» — стартовый капитал навыка и отметки о жизни не производные
 * от кликов, чтобы исчезать вместе с ними.
 */
export const MONTH_KEY_PATTERN = /^mp:[pbk]:(\d{4}-\d{2})$/;

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

/** Полный сброс кабинета: история, приоритеты, навыки, достижения, настройки. */
export async function clearEverything(): Promise<void> {
  await clearHistory();
  // Каталог навыков и достижения не месяцы, под шаблон истории не попадают, и
  // без явного удаления пережили бы сброс: пользователь прошёл бы онбординг
  // заново и обнаружил там свои старые навыки.
  await store.remove([KEY_SETTINGS, KEY_SKILLS, KEY_ACHIEVEMENTS]);
}

export interface SnapshotContents {
  settings: Settings;
  journal: Journal;
  skills: SkillsState;
  skillClicks: ClicksMap;
  awards: AwardMap;
}

export interface Snapshot extends SnapshotContents {
  app: 'my-priorities';
  /** 2 — с навыками и достижениями. Копии версии 1 читаются как пустые каталоги. */
  version: 2;
  exportedAt: string;
}

/** Выгрузка всех данных: сброс необратим, поэтому копию надо уметь забрать заранее. */
export function exportSnapshot(contents: SnapshotContents, now: Date = new Date()): string {
  const snapshot: Snapshot = {
    app: 'my-priorities',
    version: 2,
    exportedAt: now.toISOString(),
    ...contents,
  };
  return JSON.stringify(snapshot, null, 2);
}

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
export function parseSnapshot(json: string): SnapshotContents {
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
    if (!DAY_PATTERN.test(day) || !entry || typeof entry !== 'object') continue;
    const clean: DayClicks = {};
    for (const [id, count] of Object.entries(entry)) {
      const n = Number(count);
      if (Number.isFinite(n) && n > 0) clean[id] = Math.floor(n);
    }
    if (Object.keys(clean).length > 0) journal.clicks[day] = clean;
  }

  for (const [day, shifts] of Object.entries(source.battery ?? {})) {
    if (!DAY_PATTERN.test(day)) continue;
    const clean = sanitizeShifts(shifts);
    if (clean.length > 0) journal.battery[day] = clean;
  }

  // Копия первой версии просто не содержит этих полей — это не ошибка, а
  // файл, сделанный до появления модулей: читается как «навыков ещё не было».
  const skillClicks: ClicksMap = {};
  for (const [day, entry] of Object.entries(snapshot.skillClicks ?? {})) {
    if (!DAY_PATTERN.test(day) || !entry || typeof entry !== 'object') continue;
    const clean: DayClicks = {};
    for (const [id, count] of Object.entries(entry)) {
      const n = Number(count);
      if (Number.isFinite(n) && n > 0) clean[id] = Math.floor(n);
    }
    if (Object.keys(clean).length > 0) skillClicks[day] = clean;
  }

  return {
    settings,
    journal,
    skills: sanitizeSkills(snapshot.skills),
    skillClicks,
    awards: sanitizeAwards({ g: snapshot.awards }),
  };
}

/**
 * Записывает состояние целиком: настройки, каталоги и все месяцы, что есть в журналах.
 *
 * Каталог навыков и достижения пишутся всегда, даже пустыми: иначе
 * восстановление копии, сделанной до появления модулей, оставило бы в облаке
 * прежний каталог, и после перезапуска навыки вернулись бы из ниоткуда.
 */
export async function writeAll(contents: SnapshotContents): Promise<void> {
  await saveSettings(contents.settings);
  await saveSkills(contents.skills);
  await saveAwards(contents.awards);

  const months = new Set([
    ...Object.keys(contents.journal.clicks).map(monthKey),
    ...Object.keys(contents.journal.battery).map(monthKey),
  ]);
  for (const month of months) {
    await saveClicksMonth(contents.journal, month);
    await saveBatteryMonth(contents.journal, month);
  }

  for (const month of new Set(Object.keys(contents.skillClicks).map(monthKey))) {
    await saveSkillsMonth(contents.skillClicks, month);
  }
}

/** Месяцы, которые нужно держать в памяти: горизонт хранения целиком. */
export function monthsToLoad(now: Date = new Date()): string[] {
  return recentMonths(RETENTION_MONTHS, now);
}

/**
 * Чтение мимо облака, только из локальной копии. Нужно, когда клиент завис и
 * ждать его больше нельзя: показать вчерашние данные с этого устройства лучше,
 * чем не показать ничего.
 */
export async function readLocalOnly(now: Date = new Date()): Promise<{
  settings: Settings | undefined;
  journal: Journal;
  skills: SkillsState;
  skillClicks: ClicksMap;
  awards: AwardMap;
}> {
  const journal = emptyJournal();
  const skillClicks: ClicksMap = {};
  let settings: Settings | undefined;
  let skills = emptySkills();
  let awards: AwardMap = {};

  try {
    const months = monthsToLoad(now);
    const keys = [
      KEY_SETTINGS,
      KEY_SKILLS,
      KEY_ACHIEVEMENTS,
      ...months.flatMap((m) => [keyClicks(m), keyBattery(m), keySkillClicks(m)]),
    ];
    const values = await localMirror.get(keys);

    const rawSettings = values[KEY_SETTINGS];
    if (rawSettings) settings = sanitizeSettings(JSON.parse(rawSettings));
    skills = readSkills(values[KEY_SKILLS]);
    awards = readAwards(values[KEY_ACHIEVEMENTS]);

    for (const month of months) {
      const clicks = values[keyClicks(month)];
      const battery = values[keyBattery(month)];
      const skillMonth = values[keySkillClicks(month)];
      if (clicks) parseClicksMonth(month, clicks, journal);
      if (battery) parseBatteryMonth(month, battery, journal);
      if (skillMonth) parseClicksMap(month, skillMonth, skillClicks);
    }
  } catch (error) {
    console.warn('[persistence] локальная копия тоже не прочиталась', error);
  }

  return { settings, journal, skills, skillClicks, awards };
}

// --- Свёртка выпавших месяцев ------------------------------------------------

function sumMonth(raw: string | undefined, id: string): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as ClicksMonth;
    let total = 0;
    for (const entry of Object.values(parsed)) {
      const count = Number(entry?.[id]);
      if (Number.isFinite(count) && count > 0) total += Math.floor(count);
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Переносит блоки уходящих месяцев в carryBlocks навыка.
 *
 * Без этого число часов начало бы уменьшаться: через год после первой записи
 * pruneOldMonths удаляет самый старый месяц, и навык, показывавший 400 часов,
 * показал бы 380. Для лестницы, где мастер стоит на пяти тысячах, убывающий
 * счётчик бессмысленен.
 *
 * Вызывать строго до pruneOldMonths — она эти месяцы удаляет. Маркер
 * foldedThrough лежит в каталоге и уезжает в облако, поэтому второе устройство
 * тот же месяц второй раз не свернёт.
 *
 * Возвращает undefined, если сворачивать нечего.
 */
export async function foldExpiredMonths(
  skills: SkillsState,
  now: Date = new Date(),
): Promise<SkillsState | undefined> {
  if (skills.skills.length === 0) return undefined;

  try {
    const keep = new Set(recentMonths(RETENTION_MONTHS, now));
    const stale = new Set<string>();
    for (const key of await store.keys()) {
      const match = MONTH_KEY_PATTERN.exec(key);
      if (match && !keep.has(match[1]!)) stale.add(match[1]!);
    }

    const months = [...stale]
      .filter((month) => skills.foldedThrough === undefined || month > skills.foldedThrough)
      .sort();
    if (months.length === 0) return undefined;

    const values = await store.get(months.flatMap((m) => [keySkillClicks(m), keyClicks(m)]));

    const carried = new Map<string, number>();
    for (const month of months) {
      for (const skill of skills.skills) {
        let sum = sumMonth(values[keySkillClicks(month)], skill.id);
        if (skill.linkedPriorityId) {
          sum += sumMonth(values[keyClicks(month)], skill.linkedPriorityId);
        }
        if (sum > 0) carried.set(skill.id, (carried.get(skill.id) ?? 0) + sum);
      }
    }

    return {
      ...skills,
      // Маркер двигается, даже если переносить было нечего: иначе те же месяцы
      // пересматривались бы при каждом запуске до самого их удаления.
      foldedThrough: months[months.length - 1]!,
      skills: skills.skills.map((skill) => {
        const extra = carried.get(skill.id) ?? 0;
        return extra > 0 ? { ...skill, carryBlocks: skill.carryBlocks + extra } : skill;
      }),
    };
  } catch (error) {
    console.warn('[persistence] свёртка старых месяцев не удалась', error);
    return undefined;
  }
}

export type { DayKey };
