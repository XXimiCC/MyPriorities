/**
 * Вычистка личного из чего угодно.
 *
 * Приложение хранит настоящие приоритеты, навыки и историю энергии. Правило
 * «в диагностику уходят только числа» записано в devkitHost.ts, но правило,
 * которое соблюдают глазами, однажды перестают соблюдать: достаточно, чтобы
 * кто-то добавил в снимок одно удобное поле. Поэтому оно проверяется здесь
 * машинно, на выходе, и обойти его нельзя.
 *
 * Через ту же воронку идут аргументы console.error: `console.error('не
 * сохранилось', settings)` иначе увёз бы в тикет все настройки целиком.
 */

/** Ключи, которые не проходят никогда, как бы соблазнительно ни выглядели. */
const HIDDEN =
  /title|name|note|text|comment|label|query|token|access|refresh|initdata|auth|secret|password|email|phone/i;

/** Строка длиннее — это уже не перечисление и не идентификатор, а чей-то текст. */
const MAX_TEXT = 40;

const MAX_DEPTH = 4;
const MAX_KEYS = 60;
const MAX_ITEMS = 20;

/** Чем заменяется всё вырезанное. Ставится вместо, а не удаляется: пропажа поля читается хуже. */
export const CUT = '…';

/** Что узнаётся по форме, независимо от длины и имени ключа. */
const SHAPES: RegExp[] = [
  /[^\s@]+@[^\s@]+\.[^\s@]{2,}/, // почта
  /\+\d[\d\s()-]{7,}/, // телефон
  /https?:\/\/\S+[?#]\S+/, // адрес с параметрами: там же и токены входа
  /\bey[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\./, // JWT
];

function redactText(value: string): string {
  if (value.length > MAX_TEXT) return CUT;
  return SHAPES.some((shape) => shape.test(value)) ? CUT : value;
}

function walk(value: unknown, depth: number, maxDepth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  const kind = typeof value;
  if (kind === 'number' || kind === 'boolean') return value;
  if (kind === 'string') return redactText(value as string);
  // Функции, символы и всё прочее в диагностике не нужны и сериализуются мусором.
  if (kind !== 'object') return CUT;

  const object = value as object;
  // Кольцо в ссылках вешает обход, а состояние приложения — это граф, а не дерево.
  if (seen.has(object)) return CUT;
  if (depth >= maxDepth) return CUT;
  seen.add(object);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((item) => walk(item, depth + 1, maxDepth, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_KEYS)) {
    if (HIDDEN.test(key)) continue;
    result[key] = walk(item, depth + 1, maxDepth, seen);
  }
  return result;
}

/** Пропустить значение через вычистку. `maxDepth` меньше — для крошек консоли. */
export function redact(value: unknown, maxDepth: number = MAX_DEPTH): unknown {
  return walk(value, 0, maxDepth, new WeakSet());
}

/** То же, но с обещанием, что на выходе именно запись — так удобнее звать из context.ts. */
export function redactRecord(value: unknown): Record<string, unknown> | undefined {
  const cleaned = redact(value);
  if (typeof cleaned !== 'object' || cleaned === null || Array.isArray(cleaned)) return undefined;
  return cleaned as Record<string, unknown>;
}
