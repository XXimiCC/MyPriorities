/**
 * Операция — единица истории.
 *
 * До сих пор в хранилище лежало состояние: «в этот день у этого приоритета
 * четыре блока». Два устройства, записавшие один и тот же месяц, приходилось
 * сливать по ячейкам, и для счётчиков это делалось через `Math.max` — с прямо
 * задокументированной ценой: снятый блок возвращается, если его снимали на
 * одном устройстве, а второе помнит старое число.
 *
 * Здесь хранится намерение: «плюс блок», «минус блок». Сложение коммутативно,
 * повтор отсекается по `opId`, и снятие больше ничем не отличается от
 * добавления — оно просто слагаемое со знаком минус. Тот же приём чинит
 * удаление перехода заряда и снятие отметки о достижении, которых в модели
 * состояний не было вовсе.
 *
 * Цена — объём: операций сильно больше, чем ячеек. Поэтому свёртка старых
 * операций в месячные снимки не оптимизация, а условие жизнеспособности.
 */

import type { BatteryLevel, DayKey } from '../domain/types';

export const OP_KINDS = [
  /** ±n блоков приоритета. */
  'blk',
  /** ±n блоков навыка. */
  'sblk',
  /** Счётчик приоритета целиком — только импорт старых данных и восстановление копии. */
  'blkset',
  /** То же для навыка. */
  'sblkset',
  /** Переход заряда: уровень на минуте суток. */
  'bat',
  /** Ответ о расходе для перехода на той же минуте. */
  'drain',
  /** Снятие перехода. */
  'batdel',
  /** Выдача достижения. */
  'award',
  /** Снятие отметки. */
  'unaward',
  /** Барьер: история до него не считается. */
  'clear',
] as const;

export type OpKind = (typeof OP_KINDS)[number];

const KIND_SET = new Set<string>(OP_KINDS);

export interface Op {
  /** Ключ идемпотентности: повторная доставка той же операции ничего не меняет. */
  opId: string;
  kind: OpKind;
  /** Метка гибридных часов — см. `hlc.ts`. */
  hlc: string;
  day?: DayKey;
  /**
   * Кого касается операция: id приоритета, id навыка, id достижения либо ответ
   * о расходе. Последний может быть и текстом своими словами, поэтому здесь
   * нет ограничения на два символа.
   */
  targetId?: string;
  /**
   * Минута локальных суток. У переходов заряда — время перехода и часть ключа
   * ячейки; у `blk` — время нажатия, и оно необязательно: отметка за прошедший
   * день сделана не в тот день, и времени у неё нет.
   */
  minute?: number;
  /** Слагаемое для `blk`/`sblk` либо итог для `blkset`/`sblkset`. */
  amount?: number;
  level?: BatteryLevel;
}

// --- Идентификаторы ----------------------------------------------------------

const HEX = '0123456789abcdef';

/**
 * Идентификатор операции. `crypto.randomUUID` есть не везде — в частности, его
 * не будет по HTTP, а мини-апп по HTTP открывают при локальной отладке через
 * туннель. Запасной путь собирает то же самое из случайных байтов.
 */
export function newOpId(): string {
  const source = typeof crypto !== 'undefined' ? crypto : undefined;
  if (source?.randomUUID) {
    try {
      return source.randomUUID();
    } catch {
      // Небезопасный контекст: собираем сами.
    }
  }

  const bytes = new Uint8Array(16);
  if (source?.getRandomValues) source.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);

  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  let out = '';
  for (let i = 0; i < 16; i += 1) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += '-';
    const byte = bytes[i]!;
    out += HEX[byte >> 4]! + HEX[byte & 0x0f]!;
  }
  return out;
}

// --- Конструкторы ------------------------------------------------------------

/** Часы отдают метку, идентификатор берётся сам: обе заботы не должны всплывать в сторе. */
export type Stamper = () => string;

/**
 * `minute` — время нажатия, и оно есть только у записи в сегодняшний день.
 * Сервер такую операцию принимает как есть: колонка общая для всех видов и по
 * видам обязательна только заряду (`worker/src/ops.ts`).
 */
export function blockOp(
  stamp: Stamper,
  day: DayKey,
  priorityId: string,
  amount: number,
  minute?: number,
): Op {
  const op: Op = { opId: newOpId(), kind: 'blk', hlc: stamp(), day, targetId: priorityId, amount };
  if (minute !== undefined) op.minute = minute;
  return op;
}

export function skillBlockOp(stamp: Stamper, day: DayKey, skillId: string, amount: number): Op {
  return { opId: newOpId(), kind: 'sblk', hlc: stamp(), day, targetId: skillId, amount };
}

export function blockSetOp(stamp: Stamper, day: DayKey, priorityId: string, total: number): Op {
  return { opId: newOpId(), kind: 'blkset', hlc: stamp(), day, targetId: priorityId, amount: total };
}

export function skillBlockSetOp(stamp: Stamper, day: DayKey, skillId: string, total: number): Op {
  return { opId: newOpId(), kind: 'sblkset', hlc: stamp(), day, targetId: skillId, amount: total };
}

export function batteryOp(stamp: Stamper, day: DayKey, minute: number, level: BatteryLevel): Op {
  return { opId: newOpId(), kind: 'bat', hlc: stamp(), day, minute, level };
}

export function drainOp(stamp: Stamper, day: DayKey, minute: number, drainedBy: string): Op {
  return { opId: newOpId(), kind: 'drain', hlc: stamp(), day, minute, targetId: drainedBy };
}

export function batteryDeleteOp(stamp: Stamper, day: DayKey, minute: number): Op {
  return { opId: newOpId(), kind: 'batdel', hlc: stamp(), day, minute };
}

export function awardOp(stamp: Stamper, achievementId: string, day: DayKey): Op {
  return { opId: newOpId(), kind: 'award', hlc: stamp(), day, targetId: achievementId };
}

export function unawardOp(stamp: Stamper, achievementId: string): Op {
  return { opId: newOpId(), kind: 'unaward', hlc: stamp(), targetId: achievementId };
}

/**
 * Барьер стирания истории.
 *
 * Заменяет «поколение истории»: раньше удаление ключа в облаке не доезжало до
 * второго устройства, там месяц оставался в локальной копии и следующей же
 * записью заливался обратно. Барьер едет вместе с остальными операциями и
 * действует ровно тем же порядком, что и они.
 *
 * Достижений и каталогов не касается — это разные по смыслу операции, ровно
 * как `clearHistory` и `clearEverything` сегодня.
 */
export function clearOp(stamp: Stamper): Op {
  return { opId: newOpId(), kind: 'clear', hlc: stamp() };
}

// --- Толерантное чтение ------------------------------------------------------

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LEVELS: readonly number[] = [1, 2, 3, 4];

function intOrUndefined(raw: unknown): number | undefined {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : undefined;
}

/**
 * Разбор операции, пришедшей извне.
 *
 * Ответ сервера — такой же недоверенный вход, как строка из CloudStorage,
 * поэтому здесь та же дисциплина, что у `sanitizeSettings` и `sanitizeShifts`:
 * непонятное отбрасывается целиком, а не чинится наполовину. Половинчатая
 * операция хуже потерянной — она попадёт в проекцию и исказит счётчик.
 */
export function sanitizeOp(raw: unknown): Op | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Partial<Op>;

  if (typeof value.opId !== 'string' || !value.opId) return undefined;
  if (typeof value.kind !== 'string' || !KIND_SET.has(value.kind)) return undefined;
  if (typeof value.hlc !== 'string' || !value.hlc) return undefined;

  const kind = value.kind as OpKind;
  const op: Op = { opId: value.opId, kind, hlc: value.hlc };

  if (typeof value.day === 'string' && DAY_PATTERN.test(value.day)) op.day = value.day;
  if (typeof value.targetId === 'string' && value.targetId) op.targetId = value.targetId;

  const minute = intOrUndefined(value.minute);
  if (minute !== undefined) op.minute = Math.max(0, Math.min(1440, minute));

  const amount = intOrUndefined(value.amount);
  if (amount !== undefined) op.amount = amount;

  if (LEVELS.includes(Number(value.level))) op.level = Number(value.level) as BatteryLevel;

  switch (kind) {
    case 'blk':
    case 'sblk':
      // Нулевое слагаемое — не операция, а мусор: оно ничего не меняет, но
      // занимает место в журнале и в суточной квоте записи.
      return op.day && op.targetId && op.amount ? op : undefined;
    case 'blkset':
    case 'sblkset':
      return op.day && op.targetId && op.amount !== undefined && op.amount >= 0 ? op : undefined;
    case 'bat':
      return op.day && op.minute !== undefined && op.level !== undefined ? op : undefined;
    case 'drain':
      return op.day && op.minute !== undefined && op.targetId ? op : undefined;
    case 'batdel':
      return op.day && op.minute !== undefined ? op : undefined;
    case 'award':
      return op.targetId && op.day ? op : undefined;
    case 'unaward':
      return op.targetId ? op : undefined;
    case 'clear':
      return op;
  }
}

/** Порядок по метке. Ширина метки фиксирована, поэтому строкового сравнения достаточно. */
export function byHlc(a: Op, b: Op): number {
  if (a.hlc < b.hlc) return -1;
  if (a.hlc > b.hlc) return 1;
  // Метки совпали только если совпали и часы, и счётчик, и устройство — то есть
  // это одна операция, пришедшая дважды. Порядок по id делает сортировку
  // устойчивой независимо от того, в каком порядке их принесли.
  return a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0;
}
