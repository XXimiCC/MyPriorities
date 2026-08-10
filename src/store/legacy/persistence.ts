/**
 * Прежняя схема хранения. Только чтение.
 *
 * Всё здесь было продиктовано одним числом: CloudStorage давал 4096 байт на
 * значение. Отсюда нарезка истории по месяцам, дни внутри месяца как `01`..`31`,
 * двухсимвольные id приоритетов и однобуквенные поля навыков.
 *
 * Писать сюда больше нечего: источник истины на устройстве — журнал операций.
 * Осталась ровно одна обязанность — отдать накопленное разовому переносу
 * (`sync/import.ts`) и исчезнуть, когда переедут все устройства. Вместе с
 * записью отсюда ушли лимит значения, горизонт хранения, свёртка месяцев и
 * поколение истории: всё это существовало ради записи, и без неё смысла не
 * имеет.
 *
 * Стирать прежние ключи перенос намеренно не стал: перенос, который нечем
 * перепроверить, — это перенос без права на ошибку.
 */

import { store } from '../../telegram/cloudStorage';
import { composeDayKey } from '../../domain/date';
import { sanitizeShifts } from '../../domain/battery';
import { sanitizeSettings } from '../../domain/settings';
import type { BatteryShift, ClicksMap, DayClicks, Journal, Settings } from '../../domain/types';
import { emptyJournal } from '../../domain/types';
import type { SkillsState } from '../../skills/types';
import { emptySkills, sanitizeSkills } from '../../skills/types';
import { sanitizeAwards, type AwardMap } from '../../achievements/types';

const KEY_SETTINGS = 'mp:s';
/** Каталог навыков. Без даты, поэтому под месячный шаблон не попадает и историей не считается. */
const KEY_SKILLS = 'mp:k';
const KEY_ACHIEVEMENTS = 'mp:a';
const keyClicks = (month: string): string => `mp:p:${month}`;
const keyBattery = (month: string): string => `mp:b:${month}`;
const keySkillClicks = (month: string): string => `mp:k:${month}`;

// --- Настройки ---------------------------------------------------------------

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

// --- Журнал ------------------------------------------------------------------

type ClicksMonth = Record<string, DayClicks>;
type BatteryMonth = Record<string, BatteryShift[]>;

/**
 * Номер дня внутри месячного блока.
 *
 * Проверяется, потому что ключ склеивается с месяцем без разбора: `"1"` давал
 * `2026-08-1`, а такой ключ не совпадает с тем, что делает dayKey, неверно
 * сортируется строковым сравнением и не проходит формат при выгрузке копии.
 * Тридцать второго числа тоже не бывает.
 */
const DAY_OF_MONTH_PATTERN = /^(0[1-9]|[12]\d|3[01])$/;

function parseClicksMap(month: string, raw: string, into: ClicksMap): void {
  const parsed = JSON.parse(raw) as ClicksMonth;
  for (const [day, entry] of Object.entries(parsed)) {
    if (!DAY_OF_MONTH_PATTERN.test(day)) continue;
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

function parseBatteryMonth(month: string, raw: string, into: Journal): void {
  const parsed = JSON.parse(raw) as BatteryMonth;
  for (const [day, shifts] of Object.entries(parsed)) {
    if (!DAY_OF_MONTH_PATTERN.test(day)) continue;
    const clean = sanitizeShifts(shifts);
    if (clean.length > 0) into.battery[composeDayKey(month, day)] = clean;
  }
}

// --- Слияние двух копий одного месяца ----------------------------------------

/*
 * Месяц истории — один ключ, и «побеждает облако» означало, что запись со
 * второго устройства затирает всё, что накопило первое: неделя работы на
 * телефоне исчезала после того, как в тот же месяц что-то дописал компьютер.
 *
 * Сливаем по ячейкам. Для кликов ячейка — «день + приоритет», и берётся
 * большее из двух значений: счётчики почти всегда растут, а сумма удвоила бы
 * то, что оба устройства уже видели после синхронизации. Цена такого выбора —
 * снятый блок может вернуться, если его снимали на одном устройстве, а второе
 * ещё помнит старое число. Это несопоставимо дешевле потери месяца.
 *
 * Именно эта цена и есть причина переезда на журнал операций: там снятие —
 * обычное слагаемое со знаком минус, и воскресать ему нечем.
 */

/** Большее из двух значений по каждой ячейке «день → id → счётчик». */
export function mergeClicksPayload(a: string | undefined, b: string | undefined): string | undefined {
  const left = safeParseMonth(a);
  const right = safeParseMonth(b);
  if (!left) return b;
  if (!right) return a;

  const out: Record<string, Record<string, number>> = {};
  for (const source of [left, right]) {
    for (const [day, entry] of Object.entries(source)) {
      if (!DAY_OF_MONTH_PATTERN.test(day) || !entry || typeof entry !== 'object') continue;
      const target = (out[day] ??= {});
      for (const [id, raw] of Object.entries(entry)) {
        const count = Number(raw);
        if (!Number.isFinite(count) || count <= 0) continue;
        target[id] = Math.max(target[id] ?? 0, Math.floor(count));
      }
    }
  }
  return JSON.stringify(out);
}

/**
 * Объединение переходов батареи по минутам.
 *
 * Ключ ячейки — минута суток: два устройства не могут переключить заряд в одну
 * и ту же минуту по-разному чаще, чем раз в жизни. При совпадении выигрывает
 * запись с ответом о расходе: она содержит строго больше сведений.
 */
export function mergeBatteryPayload(a: string | undefined, b: string | undefined): string | undefined {
  const left = safeParseMonth(a);
  const right = safeParseMonth(b);
  if (!left) return b;
  if (!right) return a;

  const out: Record<string, BatteryShift[]> = {};
  for (const source of [left, right]) {
    for (const [day, raw] of Object.entries(source)) {
      if (!DAY_OF_MONTH_PATTERN.test(day)) continue;
      const byMinute = new Map<number, BatteryShift>(
        (out[day] ?? []).map((shift) => [shift[0], shift]),
      );
      for (const shift of sanitizeShifts(raw)) {
        const existing = byMinute.get(shift[0]);
        if (existing === undefined || (existing[2] === undefined && shift[2] !== undefined)) {
          byMinute.set(shift[0], shift);
        }
      }
      const merged = [...byMinute.values()].sort((x, y) => x[0] - y[0]);
      if (merged.length > 0) out[day] = merged;
    }
  }
  return JSON.stringify(out);
}

function safeParseMonth(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Читает указанные месяцы одним запросом — CloudStorage берёт список ключей разом. */
export async function loadJournal(months: string[]): Promise<Journal> {
  const journal = emptyJournal();
  if (months.length === 0) return journal;

  const keys = months.flatMap((month) => [keyClicks(month), keyBattery(month)]);
  const pairs = await store.getPair(keys);

  for (const month of months) {
    const clicks = pairs[keyClicks(month)];
    const battery = pairs[keyBattery(month)];
    try {
      const merged = mergeClicksPayload(clicks?.local, clicks?.remote);
      if (merged) parseClicksMonth(month, merged, journal);
    } catch {
      console.warn(`[persistence] испорчен блок кликов ${month}`);
    }
    try {
      const merged = mergeBatteryPayload(battery?.local, battery?.remote);
      if (merged) parseBatteryMonth(month, merged, journal);
    } catch {
      console.warn(`[persistence] испорчен блок батареи ${month}`);
    }
  }
  return journal;
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

export async function loadSkillClicks(months: string[]): Promise<ClicksMap> {
  const clicks: ClicksMap = {};
  if (months.length === 0) return clicks;

  const pairs = await store.getPair(months.map(keySkillClicks));
  for (const month of months) {
    const pair = pairs[keySkillClicks(month)];
    try {
      // Форма та же, что у приоритетов, поэтому и слияние то же.
      const merged = mergeClicksPayload(pair?.local, pair?.remote);
      if (merged) parseClicksMap(month, merged, clicks);
    } catch {
      console.warn(`[persistence] испорчен блок навыков ${month}`);
    }
  }
  return clicks;
}

// --- Достижения --------------------------------------------------------------

/**
 * Объединение двух наборов достижений: выдача необратима, поэтому берётся всё,
 * что есть хоть где-то, а при совпадении id — более ранняя дата. Иначе
 * достижение, полученное на телефоне, пропадало после запуска на компьютере.
 */
export function mergeAwards(a: AwardMap, b: AwardMap): AwardMap {
  const out: AwardMap = { ...a };
  for (const [id, day] of Object.entries(b)) {
    const existing = out[id];
    if (existing === undefined || day < existing) out[id] = day;
  }
  return out;
}

export async function loadAwards(): Promise<AwardMap> {
  const pair = (await store.getPair([KEY_ACHIEVEMENTS]))[KEY_ACHIEVEMENTS];
  return mergeAwards(readAwards(pair?.local), readAwards(pair?.remote));
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

// --- Уборка и сброс ----------------------------------------------------------

/**
 * Что считается историей и стирается вместе с ней. Каталог навыков `mp:k` и
 * достижения `mp:a` сюда не попадают намеренно: у них нет даты, и они переживают
 * «стереть историю» — стартовый капитал навыка и отметки о жизни не производные
 * от кликов, чтобы исчезать вместе с ними.
 */
export const MONTH_KEY_PATTERN = /^mp:[pbk]:(\d{4}-\d{2})$/;

/**
 * Все месяцы, что вообще лежат в хранилище, — без горизонта и без часов.
 *
 * Нужно разовому переносу в журнал. Горизонт в тринадцать месяцев существовал
 * ради лимита на число ключей, а перенести надо всё, что есть: пропущенное
 * здесь исчезнет навсегда, потому что второй раз перенос не делается.
 */
export async function allStoredMonths(): Promise<string[]> {
  const months = new Set<string>();
  for (const key of await store.keys()) {
    const match = MONTH_KEY_PATTERN.exec(key);
    if (match) months.add(match[1]!);
  }
  return [...months].sort();
}
