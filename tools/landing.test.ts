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

/** Рукописные страницы лендинга: русская в корне, английская в /en. */
const PAGES = ['index.html', path.join('en', 'index.html')];

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

  it.each(PAGES)('%s ссылается только на кадры из списка', (page) => {
    const html = text(path.join(LANDING, page));
    const used = [...html.matchAll(/\/shots\/([\w-]+\.png)/g)].map((match) => match[1]!);

    expect(used.length, `на ${page} нет ни одного кадра — список поехал`).toBeGreaterThan(0);
    for (const name of used) {
      expect(LANDING_SHOTS, `${page} ссылается на ${name}, которого нет в списке`).toContain(name);
    }
  });

  it.each(PAGES)('%s: адреса не разбросаны по разметке, а взяты метками', (page) => {
    const html = text(path.join(LANDING, page));
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

  it('обе страницы знают друг о друге', () => {
    /*
     * Переключатель и hreflang — единственное, что связывает две рукописные
     * страницы. Забыть их на одной из сторон легче всего в тот момент, когда
     * правишь только вторую, а поисковик и человек узнают об этом последними.
     */
    for (const page of PAGES) {
      const html = text(path.join(LANDING, page));
      expect(html, `${page}: нет ссылки на русскую версию`).toContain('hreflang="ru"');
      expect(html, `${page}: нет ссылки на английскую версию`).toContain('hreflang="en"');
      expect(html, `${page}: не отмечен текущий язык`).toContain('aria-current="page"');
    }
  });

  it('английская страница открывает английское приложение', () => {
    /*
     * Фрейм в герое и каждая ссылка «Открыть» ведут в само приложение, а язык
     * оно выбирает само — по Telegram и браузеру. Без ?lang=en английская
     * страница открывала бы русское приложение внутри собственного героя.
     */
    const html = text(path.join(LANDING, 'en', 'index.html'));
    const appLinks = [...html.matchAll(/\{\{APP\}\}[^"']*/g)].map((match) => match[0]!);

    expect(appLinks.length, 'на английской странице нет ни одной ссылки в приложение').toBeGreaterThan(0);
    for (const link of appLinks) {
      expect(link, 'ссылка в приложение без lang=en').toContain('lang=en');
    }
  });
});
