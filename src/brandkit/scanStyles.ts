/*
 * Что в стилях приложения написано мимо шкалы.
 *
 * Раздел «исключения» сначала был написан руками — и на первой же неделе
 * соврал: 9.5px переехал из подписей вкладок в статистику, а список остался
 * прежним. Руками поддерживаемый перечень того, что нарушает правило, нарушает
 * правило сам: он устаревает ровно тогда, когда становится нужен.
 *
 * Поэтому здесь стили читаются. Все CSS приложения втягиваются сырым текстом
 * (import.meta.glob + ?raw) и разбираются на литералы. Список исключений
 * получается сам и всегда соответствует коду: убрали последний 12.5px — строка
 * исчезла, добавили новый размер — строка появилась.
 *
 * Что исключено из обхода и почему:
 *   styles/tokens.css — сама шкала; сравнивать её с собой нечего;
 *   brandkit/         — витрина, а не приложение: её оформление правилам
 *                       системы не подчиняется и в отчёт попадать не должно;
 *   devkit/           — панель отладки переносится в другой проект целиком и
 *                       живёт по своим правилам (см. devkit/index.ts).
 *
 * Цена — сырой текст стилей внутри куска брендкита. Кусок ленивый и нужен
 * разработчику, а не человеку с телефоном, поэтому платит за него только тот,
 * кто открыл справочник.
 */

import { TOKEN_VALUES } from './readTokens';

const FILES = import.meta.glob('../**/*.css', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/** Одно значение и адреса, по которым оно встретилось. */
export interface StyleUse {
  value: string;
  count: number;
  /** Пути от src/, от самого частого файла к редкому. */
  where: string[];
}

const SKIP = ['../styles/tokens.css', '../devkit/'];

/*
 * Свои стили в обход не попадают. Проверка по началу пути, а не по имени
 * каталога: Vite отдаёт ключи нормализованными относительно этого файла, и
 * собственный BrandKit.css приезжает как './BrandKit.css' — подстроки
 * '/brandkit/' в нём нет вовсе, и первая версия проверки его пропускала.
 */
function ours(key: string): boolean {
  return !key.startsWith('../');
}

/** Путь вида «screens/StatsScreen.css»: '../' в начале — это и есть src/. */
function shortPath(key: string): string {
  return key.replace(/^\.\.\//, '');
}

function walk(collect: (css: string, add: (value: string) => void) => void): StyleUse[] {
  const found = new Map<string, Map<string, number>>();

  for (const [key, css] of Object.entries(FILES)) {
    if (ours(key) || SKIP.some((part) => key.startsWith(part))) continue;
    // Комментарии выкидываем целиком: в них полно значений, которые в стилях
    // уже не действуют, — как раз объяснения, почему их оттуда убрали.
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const file = shortPath(key);

    collect(clean, (value) => {
      const places = found.get(value) ?? new Map<string, number>();
      places.set(file, (places.get(file) ?? 0) + 1);
      found.set(value, places);
    });
  }

  return [...found.entries()]
    .map(([value, places]) => ({
      value,
      count: [...places.values()].reduce((sum, n) => sum + n, 0),
      where: [...places.entries()].sort((a, b) => b[1] - a[1]).map(([file]) => file),
    }))
    .sort((a, b) => b.count - a.count);
}

const PX = /^\d+(\.\d+)?px$/;

/**
 * Кегли-литералы, не совпавшие ни с одной ступенью шкалы. Значения из var() и
 * clamp() пропускаются: первое и есть шкала, второе живёт только на лендинге.
 */
export const FONT_SIZE_OUTLIERS: StyleUse[] = walk((css, add) => {
  for (const match of css.matchAll(/font-size:\s*([^;{}]+);/g)) {
    const value = match[1]?.trim().toLowerCase();
    if (!value || !PX.test(value)) continue;
    if (TOKEN_VALUES.has(value)) continue;
    add(value);
  }
});

/**
 * Цвета, прибитые в стилях литералом, а не взятые токеном.
 *
 * Совпадающие с токеном не отфильтровываются, и это главное в списке: `#000`,
 * написанный руками там, где есть `--bg`, — ровно тот случай, ради которого
 * обход и заведён. Значение то же, связи нет: поменяется токен — это место
 * останется прежним и разойдётся со всем остальным.
 *
 * Вычистить список до нуля нельзя и не нужно. Чёрный текст на неоновой заливке
 * не должен зависеть от палитры — иначе он поедет вместе с ней и перестанет
 * читаться; золото плашки достижения живёт вне палитры намеренно. Список нужен,
 * чтобы каждая строка в нём была объяснимой: необъяснимая — это и есть
 * расползание стилей, и увидеть её надо до того, как она размножится.
 */
export const HEX_LITERALS: StyleUse[] = walk((css, add) => {
  for (const match of css.matchAll(/#([\da-f]{3}|[\da-f]{6})\b/gi)) {
    const raw = match[1]!.toLowerCase();
    add(`#${raw.length === 3 ? [...raw].map((ch) => ch + ch).join('') : raw}`);
  }
});
