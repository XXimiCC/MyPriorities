/**
 * Копия данных: выгрузка и разбор.
 *
 * Это формат домена, а не хранилища. Внутри всё лежит в читаемом виде — навыки
 * полями с человеческими именами, дни полными датами, — потому что файл открывают
 * и читают глазами. Компактные приёмы хранилища (двухсимвольные ключи дней,
 * однобуквенные поля) сюда не проникают и не должны: они существуют ради лимита
 * в 4096 байт, которого у файла нет.
 *
 * Поэтому смена бэкенда копию не затрагивает вовсе: и выгрузка, и восстановление
 * работают с состоянием приложения, а не с тем, где оно лежит.
 */

import { sanitizeAwards, type AwardMap } from '../achievements/types';
import { sanitizeSkills } from '../skills/types';
import type { SkillsState } from '../skills/types';
import type { StringKey } from '../i18n';
import { sanitizeShifts } from './battery';
import { sanitizeSettings } from './settings';
import type { ClicksMap, DayClicks, Journal, Settings } from './types';
import { emptyJournal, timelessMarks } from './types';

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

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Общая часть для приоритетов и навыков: форма у них одна. */
function readClicks(source: unknown): ClicksMap {
  const out: ClicksMap = {};
  if (typeof source !== 'object' || source === null) return out;

  for (const [day, entry] of Object.entries(source as Record<string, unknown>)) {
    if (!DAY_PATTERN.test(day) || !entry || typeof entry !== 'object') continue;
    const clean: DayClicks = {};
    for (const [id, count] of Object.entries(entry as Record<string, unknown>)) {
      const n = Number(count);
      if (Number.isFinite(n) && n > 0) clean[id] = Math.floor(n);
    }
    if (Object.keys(clean).length > 0) out[day] = clean;
  }
  return out;
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
  journal.clicks = readClicks(source.clicks);
  /*
   * Копия хранит итоги, а не отдельные нажатия, — и восстановление возвращает
   * их установкой счётчика (`blkset`). Времена через файл не ездят: копия могла
   * быть сделана и до того, как они появились. Стек всё равно нужен — счётчик
   * считается его длиной.
   */
  journal.marks = timelessMarks(journal.clicks);

  for (const [day, shifts] of Object.entries(source.battery ?? {})) {
    if (!DAY_PATTERN.test(day)) continue;
    const clean = sanitizeShifts(shifts);
    if (clean.length > 0) journal.battery[day] = clean;
  }

  return {
    settings,
    journal,
    // Копия первой версии просто не содержит этих полей — это не ошибка, а
    // файл, сделанный до появления модулей: читается как «навыков ещё не было».
    skills: sanitizeSkills(snapshot.skills),
    skillClicks: readClicks(snapshot.skillClicks),
    awards: sanitizeAwards({ g: snapshot.awards }),
  };
}
