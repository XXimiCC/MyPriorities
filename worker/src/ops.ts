/**
 * Разбор операций на стороне сервера.
 *
 * Повторяет проверки клиента, а не доверяет им: тело запроса приходит из сети,
 * и «клиент уже проверил» — не довод. Правила те же, что в `src/sync/ops.ts`
 * приложения, и расхождение между ними означало бы, что сервер хранит то, чего
 * клиент не умеет прочитать.
 */

const KINDS = new Set([
  'blk',
  'sblk',
  'blkset',
  'sblkset',
  'bat',
  'drain',
  'batdel',
  'award',
  'unaward',
  'clear',
]);

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ширина метки фиксирована — на этом держится сравнение строками. */
const HLC_PATTERN = /^\d{15}:\d{5}:[a-z0-9]{1,32}$/;

/** Ответ о расходе может быть текстом своими словами, отсюда запас. */
const MAX_TARGET = 64;

export interface StoredOp {
  opId: string;
  kind: string;
  hlc: string;
  day: string | null;
  targetId: string | null;
  minute: number | null;
  amount: number | null;
  level: number | null;
}

function intOrNull(raw: unknown, min: number, max: number): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Приводит операцию к тому, что можно положить в таблицу. undefined — не кладём.
 *
 * Отбрасываем целиком, а не чиним наполовину: половинчатая операция хуже
 * потерянной, потому что она попадёт в проекцию и исказит счётчик.
 */
export function sanitizeOp(raw: unknown): StoredOp | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;

  const opId = value.opId;
  const kind = value.kind;
  const hlc = value.hlc;
  if (typeof opId !== 'string' || !UUID_PATTERN.test(opId)) return undefined;
  if (typeof kind !== 'string' || !KINDS.has(kind)) return undefined;
  if (typeof hlc !== 'string' || !HLC_PATTERN.test(hlc)) return undefined;

  const day = typeof value.day === 'string' && DAY_PATTERN.test(value.day) ? value.day : null;
  const targetId =
    typeof value.targetId === 'string' && value.targetId
      ? value.targetId.slice(0, MAX_TARGET)
      : null;
  const minute = value.minute === undefined ? null : intOrNull(value.minute, 0, 1440);
  const amount = value.amount === undefined ? null : intOrNull(value.amount, -100_000, 100_000);
  const level = value.level === undefined ? null : intOrNull(value.level, 1, 4);

  const op: StoredOp = { opId, kind, hlc, day, targetId, minute, amount, level };

  switch (kind) {
    case 'blk':
    case 'sblk':
      return day && targetId && amount ? op : undefined;
    case 'blkset':
    case 'sblkset':
      return day && targetId && amount !== null && amount >= 0 ? op : undefined;
    case 'bat':
      return day && minute !== null && level !== null ? op : undefined;
    case 'drain':
      return day && minute !== null && targetId ? op : undefined;
    case 'batdel':
      return day && minute !== null ? op : undefined;
    case 'award':
      return targetId && day ? op : undefined;
    case 'unaward':
      return targetId ? op : undefined;
    case 'clear':
      return op;
    default:
      return undefined;
  }
}
