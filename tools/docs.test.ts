/**
 * Связность документации.
 *
 * Документация — часть поставки, и её расхождение с кодом должно ловиться здесь,
 * а не читателем через полгода.
 *
 * Тест лежит в tools/, а не в src/: он ходит по файловой системе, а значит
 * требует типов Node. В src/ это заставило бы добавить "node" в tsconfig
 * приложения, и Node API стали бы видны продуктовому коду, которому их видеть
 * незачем. vite.config.ts включает tools/ в набор тестов специально ради этого.
 *
 * Чего этот тест НЕ проверяет: соответствие текста поведению кода. Проверить это
 * нельзя, а имитация проверки опаснее её отсутствия.
 *
 * Единственное исключение — числа в «Пределах»: страница объявила себя их
 * единственным владельцем, а у части из них есть константа в коде. Это уже не
 * текст, а значение, и сверить его можно буквально. См. LIMIT_ROWS.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { GROUPS } from '../src/achievements/types';
import { MAX_INSIGHTS } from '../src/domain/insights';
import { MAX_ARCHIVED } from '../src/domain/settings';
import { BLOCK_OPTIONS, DEFAULT_PRIORITY_COUNT, MAX_PRIORITIES, MIN_PRIORITIES } from '../src/domain/types';
import { MAX_ARCHIVED_SKILLS, MAX_SKILLS } from '../src/skills/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const SHOTS = path.join(DOCS, 'public', 'shots');

/**
 * Экран приложения → страница документации.
 *
 * Карта заведена руками намеренно: новый экран роняет тест на «нет записи в
 * карте», а не проходит молча, потому что имена случайно совпали.
 */
const SCREEN_PAGES: Record<string, string> = {
  'AchievementsScreen.tsx': 'screens/achievements.md',
  'ChargeScreen.tsx': 'screens/charge.md',
  'DemoScreen.tsx': 'screens/demo.md',
  'EditPrioritiesScreen.tsx': 'screens/edit.md',
  'HomeScreen.tsx': 'screens/home.md',
  'OnboardingScreen.tsx': 'screens/onboarding.md',
  'PresetsScreen.tsx': 'screens/presets.md',
  'SettingsScreen.tsx': 'screens/settings.md',
  'SkillsScreen.tsx': 'screens/skills.md',
  'StatsScreen.tsx': 'screens/stats.md',
};

/**
 * Строка таблицы «Что видит пользователь» в limits.md → числа, которые в ней
 * обязаны стоять.
 *
 * Карта заведена руками — по той же причине, что и SCREEN_PAGES: разбирать все
 * числа страницы регуляркой значит сверять и «4096» из объяснения, и «24 знака»
 * из соседней строки, у которых константы нет вовсе. Здесь адресно: имя строки
 * и имена констант.
 *
 * Сверяется только колонка «Предел». Соседняя колонка — проза, и проговорённое
 * в ней словами прежнее число («двенадцать направлений») тест не поймает:
 * поправив цифру, обоснование надо перечитать глазами.
 */
const LIMIT_ROWS: Array<{ row: string; numbers: number[] }> = [
  { row: 'Приоритетов', numbers: [MIN_PRIORITIES, MAX_PRIORITIES, DEFAULT_PRIORITY_COUNT] },
  { row: 'Приоритетов в архиве', numbers: [MAX_ARCHIVED] },
  { row: 'Навыков', numbers: [MAX_SKILLS] },
  { row: 'Навыков в архиве', numbers: [MAX_ARCHIVED_SKILLS] },
  { row: 'Цена одного клика', numbers: [...BLOCK_OPTIONS] },
  { row: 'Наблюдений на экране', numbers: [MAX_INSIGHTS] },
];

/** Все .md документации с их содержимым. */
function markdownFiles(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // .vitepress — это конфиг и тема, а не страницы.
      if (entry.name === '.vitepress' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) {
        out.push({ file: path.relative(DOCS, full), text: readFileSync(full, 'utf8') });
      }
    }
  };

  walk(DOCS);
  return out;
}

/**
 * Копия slugify из @mdit-vue/shared, которым VitePress делает якоря заголовков.
 *
 * Копия, а не импорт: пакет лежит в docs/node_modules и корневым тестам не
 * виден. Совпадение проверено на всех заголовках сайта; если VitePress однажды
 * сменит правило, тест начнёт врать — поэтому строка правил вынесена сюда
 * целиком, а не разобрана по кусочкам.
 *
 * Практическое следствие правила, о котором легко забыть: «й» и «ё» после
 * NFKD распадаются на букву и диакритику, диакритика выкидывается, и в якоре
 * остаются «и» и «е». Ссылка на #исправить-лишний-тап никуда не ведёт.
 */
function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase();
}

/** Якоря страницы: заголовки вне блоков кода и вне шаблонных подстановок. */
function anchorsOf(markdown: string): Set<string> {
  const withoutFences = markdown.replace(/^```[\s\S]*?^```/gm, '');
  return new Set(
    [...withoutFences.matchAll(/^#{1,6} (.+)$/gm)]
      .map((m) => m[1]!.trim())
      .filter((title) => !title.includes('{{'))
      .map(slugify),
  );
}

/**
 * Где на кадры ссылаются: страницы документации и оба корневых README.
 *
 * README тоже часть поставки и тоже показывает кадры — английский свои,
 * русский свои. Без него английская четвёрка из шапки не имела бы ни одной
 * ссылки внутри docs/ и падала бы как «мёртвый кадр».
 */
function shotReferrers(): Array<{ file: string; text: string }> {
  const readmes = ['README.md', 'README.ru.md'].map((file) => ({
    file,
    text: readFileSync(path.join(ROOT, file), 'utf8'),
  }));
  return [...markdownFiles(), ...readmes];
}

/** Имена кадров, на которые ссылается markdown. */
function referencedShots(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const { file, text } of shotReferrers()) {
    for (const match of text.matchAll(/\/shots\/([\w-]+)\.png/g)) {
      const name = match[1]!;
      used.set(name, [...(used.get(name) ?? []), file]);
    }
  }
  return used;
}

describe('документация', () => {
  it('у каждого экрана есть своя страница', () => {
    const screens = readdirSync(path.join(ROOT, 'src', 'screens')).filter((name) =>
      name.endsWith('Screen.tsx'),
    );

    for (const screen of screens) {
      const page = SCREEN_PAGES[screen];
      expect(page, `нет записи в SCREEN_PAGES для ${screen}`).toBeDefined();
      expect(existsSync(path.join(DOCS, page!)), `нет страницы ${page}`).toBe(true);
    }

    // И обратно: карта не должна пережить удалённый экран.
    for (const screen of Object.keys(SCREEN_PAGES)) {
      expect(screens, `экран ${screen} исчез, а запись в карте осталась`).toContain(screen);
    }
  });

  it('каждый кадр из манифеста снят', async () => {
    const { RUNS } = (await import('./shots/scenarios.mjs')) as {
      RUNS: Array<{ shots: Array<{ name: string; note?: string }> }>;
    };

    const names = RUNS.flatMap((run) => run.shots.map((shot) => shot.name));
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size, 'имена кадров должны быть уникальны').toBe(names.length);

    for (const name of names) {
      expect(existsSync(path.join(SHOTS, `${name}.png`)), `не снят кадр ${name}`).toBe(true);
    }
  });

  it('каждый кадр из манифеста описан', async () => {
    const { RUNS } = (await import('./shots/scenarios.mjs')) as {
      RUNS: Array<{ shots: Array<{ name: string; note?: string }> }>;
    };

    for (const run of RUNS) {
      for (const shot of run.shots) {
        expect(shot.note, `у кадра ${shot.name} нет подписи`).toBeTruthy();
      }
    }
  });

  it('каждая ссылка на кадр ведёт на существующий файл', () => {
    for (const [name, files] of referencedShots()) {
      expect(
        existsSync(path.join(SHOTS, `${name}.png`)),
        `${files.join(', ')} ссылается на несуществующий /shots/${name}.png`,
      ).toBe(true);
    }
  });

  it('мёртвых кадров не накопилось', () => {
    const used = referencedShots();
    const orphans = readdirSync(SHOTS)
      .filter((file) => file.endsWith('.png'))
      .map((file) => file.replace(/\.png$/, ''))
      .filter((name) => !used.has(name));

    expect(orphans, 'кадры есть, а ссылок на них нет').toEqual([]);
  });

  it('каждая якорная ссылка ведёт на существующий заголовок', () => {
    const pages = new Map(markdownFiles().map(({ file, text }) => [file, text]));
    const problems: string[] = [];

    for (const [file, text] of pages) {
      for (const match of text.matchAll(/\]\((\/[a-z0-9/-]+)#([^)\s]+)\)/g)) {
        const target = `${match[1]!.replace(/^\//, '')}.md`;
        const page = pages.get(target) ?? pages.get(target.split('/').join(path.sep));
        if (!page) {
          problems.push(`${file}: нет страницы ${match[1]}`);
          continue;
        }
        const anchor = decodeURIComponent(match[2]!);
        if (!anchorsOf(page).has(anchor)) {
          problems.push(`${file}: нет заголовка ${match[1]}#${anchor}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it('числа в «Пределах» совпадают с константами', () => {
    const page = readFileSync(path.join(DOCS, 'topics', 'limits.md'), 'utf8');
    const problems: string[] = [];

    for (const { row, numbers } of LIMIT_ROWS) {
      // Ячейки строки таблицы: «| Что | Предел | Откуда он взялся |».
      const line = page.split(/\r?\n/).find((text) => text.split('|')[1]?.trim() === row);

      if (!line) {
        problems.push(`нет строки «${row}» — переименовали?`);
        continue;
      }

      const found = [...(line.split('|')[2] ?? '').matchAll(/\d+/g)].map((m) => Number(m[0]));
      const sorted = (list: number[]): string => [...list].sort((a, b) => a - b).join(', ');

      if (sorted(found) !== sorted(numbers)) {
        problems.push(`«${row}»: в коде ${sorted(numbers)}, на странице ${sorted(found) || '—'}`);
      }
    }

    expect(problems).toEqual([]);
  });

  it('в справочнике достижений есть заголовок под каждую группу', () => {
    // Заголовки групп стоят в markdown статически — ради якорей и оглавления,
    // — а строки таблиц приходят из реестра. Здесь сторожим, что они не разошлись.
    const page = readFileSync(path.join(DOCS, 'topics', 'achievements-catalogue.md'), 'utf8');
    const rendered = [...page.matchAll(/ach\.byGroup\.(\w+)/g)].map((m) => m[1]!);

    expect([...rendered].sort()).toEqual([...GROUPS].sort());
  });
});
