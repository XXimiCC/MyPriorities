/**
 * Копии, которыми живёт лендинг, не разъехались с источниками.
 *
 * Лендинг — отдельный проект Vercel с Root Directory = `landing`, и файлы вне
 * своего каталога он в сборку не получает. Отсюда копии токенов и кадров вместо
 * импорта из `../src` и `../docs` — и отсюда же нужда в стороже: копия без него
 * расходится тихо, а обнаруживается тем, что лендинг перестаёт быть похож на
 * приложение, которое рекламирует.
 *
 * Обновляются копии командой `npm run landing:sync`.
 *
 * Тест лежит в tools/ по той же причине, что и docs.test.ts: ему нужны типы
 * Node, а продуктовому коду их видеть незачем.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// @ts-expect-error — .mjs без типов; список читают и синхронизация, и этот тест
import { LANDING_COPIES, LANDING_SHOTS } from './landing/shots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANDING = path.join(ROOT, 'landing');
const LANDING_SHOTS_DIR = path.join(LANDING, 'public', 'shots');

/**
 * Перевод строк нормализуется: `.gitattributes` в репозитории нет, и checkout
 * на Windows мог бы отдать одному файлу CRLF, а другому LF. Расхождение в
 * невидимых символах — не то расхождение, ради которого этот тест написан.
 */
const text = (file: string): string => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

describe('копии лендинга', () => {
  it.each(LANDING_COPIES as Array<[string, string]>)('%s — точная копия', (from, to) => {
    const target = path.join(LANDING, to);
    expect(existsSync(target), `нет ${to}; выполните npm run landing:sync`).toBe(true);
    expect(text(target), `${to} разъехался с ${from}`).toBe(text(path.join(ROOT, from)));
  });

  it.each(LANDING_SHOTS as string[])('кадр %s совпадает с кадром документации', (name) => {
    const target = path.join(LANDING_SHOTS_DIR, name);
    expect(existsSync(target), `нет кадра ${name}; выполните npm run landing:sync`).toBe(true);
    expect(
      readFileSync(target).equals(readFileSync(path.join(ROOT, 'docs', 'public', 'shots', name))),
      `кадр ${name} разъехался с документацией`,
    ).toBe(true);
  });

  it('посторонних кадров не накопилось', () => {
    const extra = readdirSync(LANDING_SHOTS_DIR).filter((name) => !LANDING_SHOTS.includes(name));
    expect(extra, 'кадры лежат, а в списке их нет').toEqual([]);
  });

  it('страница ссылается только на кадры из списка', () => {
    const html = text(path.join(LANDING, 'index.html'));
    const used = [...html.matchAll(/\/shots\/([\w-]+\.png)/g)].map((match) => match[1]!);

    expect(used.length, 'на странице нет ни одного кадра — список поехал').toBeGreaterThan(0);
    for (const name of used) {
      expect(LANDING_SHOTS, `index.html ссылается на ${name}, которого нет в списке`).toContain(
        name,
      );
    }
  });

  it('адреса не разбросаны по разметке, а взяты метками', () => {
    const html = text(path.join(LANDING, 'index.html'));
    /*
     * Смысл проверки: появится свой домен — правится site.config.js и больше
     * ничего. Захардкоженная ссылка пережила бы переезд и увела бы человека
     * на старый адрес.
     */
    const hardcoded = [...html.matchAll(/https?:\/\/[^\s"'<>]+/g)]
      .map((match) => match[0]!)
      // Схемы и словари — не адреса, по которым ходят люди.
      .filter((url) => !url.startsWith('http://www.w3.org/'));

    expect(hardcoded, 'адреса живут в site.config.js и подставляются метками {{…}}').toEqual([]);
  });
});
