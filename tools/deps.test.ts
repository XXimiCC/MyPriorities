import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/*
 * Два обещания, которые легко нарушить и трудно заметить.
 *
 * Первое: «в приложении только React». У него ровно одно исключение —
 * modern-screenshot в панели отладки, — и оно должно быть названо в
 * документации, а не обнаруживаться при чтении package.json.
 *
 * Второе: каталог src/devkit/ переносится в другой проект копированием. Это
 * держится на том, что он ничего не импортирует за свои пределы. Правило,
 * которое соблюдают глазами, перестают соблюдать в первый же занятый день,
 * поэтому его сторожит машина — как и связность документации в docs.test.ts.
 */

const ROOT = path.resolve(__dirname, '..');
const DEVKIT = path.join(ROOT, 'src', 'devkit');

const ALLOWED_RUNTIME = ['react', 'react-dom', 'modern-screenshot'];
const ALLOWED_IN_DEVKIT = new Set(['react', 'react-dom/client', 'modern-screenshot']);

function read(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

/** Тесты не в счёт: они не едут в сборку и переносятся вместе с каталогом. */
function devkitFiles(): string[] {
  return fs
    .readdirSync(DEVKIT)
    .filter((name) => (name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.test.ts'))
    .map((name) => path.join(DEVKIT, name));
}

/** Все спецификаторы из import/export ... from '...' и динамического import('...'). */
function specifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1] as string);
  }
  return found;
}

describe('зависимости приложения', () => {
  it('в сборку едут только разрешённые', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).sort()).toEqual([...ALLOWED_RUNTIME].sort());
  });

  it('единственное исключение названо в документации', () => {
    // Иначе правило «без библиотек» тихо превращается в «библиотеки бывают».
    expect(read('README.md')).toContain('modern-screenshot');
    expect(read('docs/dev/architecture.md')).toContain('modern-screenshot');
  });

  it('файлы локалей ничего не импортируют', () => {
    /*
     * На этом держится tools/shots/labels.mjs: он читает ru.ts напрямую нодой,
     * без сборщика, — стрипание типов включено, а разрешение импортов нет.
     * Первый же import сломает съёмку, и не ошибкой компиляции, а падением
     * скрипта, до которого доходят раз в неделю. Соблазн реальный: аннотировать
     * ruFormats типом LocaleFormats из index.ts выглядит как наведение порядка.
     */
    for (const file of ['src/i18n/ru.ts', 'src/i18n/en.ts']) {
      expect(specifiers(read(file)), file).toEqual([]);
    }
  });
});

describe('переносимость панели отладки', () => {
  it('каталог не тянет ничего из приложения', () => {
    const escapes: string[] = [];

    for (const file of devkitFiles()) {
      for (const specifier of specifiers(fs.readFileSync(file, 'utf8'))) {
        const relative = specifier.startsWith('.');
        const inside = relative && !specifier.startsWith('..');
        if (inside) continue;
        if (!relative && ALLOWED_IN_DEVKIT.has(specifier)) continue;
        escapes.push(`${path.basename(file)} → ${specifier}`);
      }
    }

    expect(escapes).toEqual([]);
  });

  it('вход отдаёт ровно то, чем его ставят', () => {
    const entry = read('src/devkit/index.ts');
    expect(entry).toContain('mountDevkit');
    expect(entry).toContain('registerDevkitHost');
  });

  it('весь клей с приложением собран в двух известных файлах', () => {
    /*
     * Панель зовут из двух мест, и оба — про панель, а не про приложение:
     * main.tsx ставит её, devkitHost.ts отдаёт наружу снимок состояния и
     * вызов «показать значок». Экраны обращаются к devkitHost, а не к панели
     * напрямую: выключить её должно быть правкой в известных местах, а не
     * поиском по всему src/.
     */
    const users = fs
      .readdirSync(path.join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.tsx') || name.endsWith('.ts'))
      .filter((name) => !name.startsWith('devkit' + path.sep))
      .filter((name) => /from '\.{1,2}\/devkit'/.test(read(path.join('src', name))));

    expect(users.sort()).toEqual(['devkitHost.ts', 'main.tsx']);
  });
});
