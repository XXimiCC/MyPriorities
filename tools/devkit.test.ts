import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEVKIT_COPIES } from './devkit/copies.mjs';

/*
 * Панель отладки лежит на документации и лендинге готовыми файлами: каталог
 * src/ приложения в эти проекты Vercel не доезжает (Root Directory = docs и
 * = landing). Цена такого решения — расхождение копий, и ловится оно здесь, а
 * не глазом на проде. Тот же сторож, что у копий лендинга.
 */

const ROOT = path.resolve(__dirname, '..');

function files(dir: string): string[] {
  const full = path.join(ROOT, dir);
  return fs.existsSync(full) ? fs.readdirSync(full).sort() : [];
}

describe('копии панели отладки', () => {
  const [first, ...rest] = DEVKIT_COPIES as string[];

  it('собраны и лежат на месте', () => {
    // Пусто — значит забыли `npm run devkit:sync` после правки src/devkit/.
    expect(files(first as string).length).toBeGreaterThan(0);
    expect(files(first as string)).toContain('devkit.js');
  });

  it('одинаковы на всех сайтах', () => {
    for (const other of rest) {
      expect(files(other), `состав ${other} разошёлся`).toEqual(files(first as string));
      for (const name of files(other)) {
        expect(
          fs.readFileSync(path.join(ROOT, other, name)).equals(fs.readFileSync(path.join(ROOT, first as string, name))),
          `${name} в ${other} разошёлся`,
        ).toBe(true);
      }
    }
  });

  it('вход остаётся лёгким', () => {
    /*
     * Он грузится на каждой странице документации у каждого посетителя, и
     * платят за него все. React, съёмка кадра и сам слой приезжают отдельными
     * кусками только при первом открытии панели — если этот файл вдруг
     * растолстел, значит что-то из тяжёлого уехало в него статическим импортом.
     */
    const entry = path.join(ROOT, first as string, 'devkit.js');
    expect(fs.statSync(entry).size).toBeLessThan(16 * 1024);
  });

  it('тяжёлое лежит отдельно', () => {
    const names = files(first as string);
    expect(names.some((name) => name.startsWith('devkit-render'))).toBe(true);
    expect(names.some((name) => name.endsWith('.css'))).toBe(true);
  });

  it('подключены обоими сайтами', () => {
    const docs = fs.readFileSync(path.join(ROOT, 'docs', '.vitepress', 'config.mts'), 'utf8');
    const landing = fs.readFileSync(path.join(ROOT, 'landing', 'index.html'), 'utf8');
    for (const source of [docs, landing]) {
      expect(source).toContain('/devkit/devkit.js');
      expect(source).toContain('data-devkit-url');
    }
  });
});
