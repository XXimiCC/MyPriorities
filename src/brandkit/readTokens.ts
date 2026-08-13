/*
 * Брендкит читает токены, а не повторяет их.
 *
 * Список токенов нигде не продублирован: файл styles/tokens.css втягивается
 * сырым текстом (?raw) и разбирается здесь. Заголовки групп берутся из тех же
 * комментариев «--- Поверхности ---», которыми файл размечен для человека, а
 * подписи отдельных токенов — из хвостовых комментариев в конце строки.
 *
 * Смысл ровно один: страница не может соврать. Удалили токен — исчезла плашка,
 * переименовали — переехала сама, добавили — появилась без единой правки здесь.
 * Ручной список, который надо не забыть обновить, разошёлся бы с файлом на
 * второй неделе.
 *
 * Фактическое значение берём через getComputedStyle, а не из текста: так
 * `--accent: var(--text)` показывается разрешённым цветом, а env() у безопасных
 * зон — настоящими пикселями устройства.
 */

import source from '../styles/tokens.css?raw';

export interface TokenRow {
  /** Имя вместе с двумя дефисами: --p0. */
  name: string;
  /** Что написано в файле: может быть var(...) или env(...). */
  declared: string;
  /** Хвостовой комментарий строки, если он есть. */
  note?: string;
}

export interface TokenGroup {
  title: string;
  /** Остаток заголовка после первой точки или двоеточия — пояснение к группе. */
  hint?: string;
  tokens: TokenRow[];
}

const GROUP_LINE = /^\/\*\s*---\s*(.+?)\s*---\s*\*\/$/;
const TOKEN_LINE = /^(--[\w-]+)\s*:\s*(.+?)\s*;\s*(?:\/\*\s*(.*?)\s*\*\/)?$/;

/**
 * Разбор идёт построчно и только внутри :root — за его пределами в файле лежат
 * утилиты (.neon-text и соседи), и их объявления токенами не являются.
 */
function parse(css: string): TokenGroup[] {
  const groups: TokenGroup[] = [];
  let current: TokenGroup | undefined;
  let insideRoot = false;
  let insideComment = false;

  for (const raw of css.split('\n')) {
    const line = raw.trim();

    // Многострочные пояснения пропускаем целиком: заголовок группы всегда
    // умещается в одну строку, и разбирать их нечем.
    if (insideComment) {
      if (line.endsWith('*/')) insideComment = false;
      continue;
    }
    if (line.startsWith('/*') && !line.endsWith('*/')) {
      insideComment = true;
      continue;
    }

    if (!insideRoot) {
      if (line.startsWith(':root')) insideRoot = true;
      continue;
    }
    if (line === '}') break;

    const group = GROUP_LINE.exec(line);
    if (group?.[1]) {
      current = { ...splitTitle(group[1]), tokens: [] };
      groups.push(current);
      continue;
    }

    const token = TOKEN_LINE.exec(line);
    if (!token?.[1] || !token[2]) continue;

    // Токен до первого заголовка складывать некуда — заводим группу без имени.
    if (!current) {
      current = { title: 'Прочее', tokens: [] };
      groups.push(current);
    }
    current.tokens.push({
      name: token[1],
      declared: token[2],
      ...(token[3] ? { note: token[3] } : {}),
    });
  }

  return groups.filter((item) => item.tokens.length > 0);
}

/** «Уровни батареи (взяты пипеткой)» → заголовок и пояснение к нему. */
function splitTitle(title: string): { title: string; hint?: string } {
  const cut = title.search(/[.:(]/);
  if (cut < 0) return { title };
  return {
    title: title.slice(0, cut).trim(),
    hint: title
      .slice(cut)
      .replace(/^[.:(]\s*/, '')
      .replace(/\)$/, '')
      .trim(),
  };
}

export const TOKEN_GROUPS: TokenGroup[] = parse(source);

/** Плоский поиск по имени: разделам нужны отдельные токены, а не вся группа. */
const BY_NAME = new Map(TOKEN_GROUPS.flatMap((g) => g.tokens).map((row) => [row.name, row]));

/**
 * Все объявленные значения разом, в нижнем регистре. По этому множеству
 * scanStyles.ts отличает литерал, повторяющий токен, от литерала, который живёт
 * сам по себе, — и второе попадает в списки исключений.
 */
export const TOKEN_VALUES = new Set(
  TOKEN_GROUPS.flatMap((g) => g.tokens).map((row) => row.declared.trim().toLowerCase()),
);

export function tokenNames(prefix: string): string[] {
  return [...BY_NAME.keys()].filter((name) => name.startsWith(prefix));
}

/**
 * Вычисленное значение токена. Читается у корня документа, потому что там оно и
 * объявлено; в SSR-окружения приложение не ходит, но проверка дешевле падения.
 */
export function computedToken(name: string): string {
  if (typeof document === 'undefined') return BY_NAME.get(name)?.declared ?? '';
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || (BY_NAME.get(name)?.declared ?? '');
}

/* --- Контраст ---
 *
 * Половина текстовых цветов приложения — белый с прозрачностью, а не сплошной
 * тон. Считать их контраст по номиналу нельзя: rgba(244,244,245,0.34) на чёрном
 * — это совсем не #f4f4f5. Поэтому цвет сначала накладывается на фон, и только
 * потом идёт в формулу WCAG.
 */

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string): Rgba | undefined {
  const text = value.trim();

  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(text);
  if (hex?.[1]) {
    const digits =
      hex[1].length === 3
        ? [...hex[1]].map((ch) => ch + ch).join('')
        : hex[1];
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: 1,
    };
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (rgb?.[1]) {
    const parts = rgb[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    const [r, g, b, a] = parts;
    if (r === undefined || g === undefined || b === undefined) return undefined;
    return { r, g, b, a: a ?? 1 };
  }

  return undefined;
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (value: number): number => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Отношение контраста цвета к фону. undefined — цвет не разобрался. */
export function contrastOn(color: string, background: string): number | undefined {
  const front = parseColor(color);
  const back = parseColor(background);
  if (!front || !back) return undefined;

  const flat: Rgba = {
    r: front.r * front.a + back.r * (1 - front.a),
    g: front.g * front.a + back.g * (1 - front.a),
    b: front.b * front.a + back.b * (1 - front.a),
    a: 1,
  };

  const light = Math.max(luminance(flat), luminance(back));
  const dark = Math.min(luminance(flat), luminance(back));
  return (light + 0.05) / (dark + 0.05);
}

/** Ярлык уровня доступности для обычного текста. */
export function contrastGrade(ratio: number): { label: string; ok: boolean } {
  if (ratio >= 7) return { label: 'AAA', ok: true };
  if (ratio >= 4.5) return { label: 'AA', ok: true };
  if (ratio >= 3) return { label: 'AA крупный', ok: true };
  return { label: 'мало', ok: false };
}
