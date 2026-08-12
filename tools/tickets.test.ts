import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseEnvFile } from './tickets/config.mjs';
import { folderFor } from './tickets/pull.mjs';
import { renderTicket } from './tickets/render.mjs';

const payload = {
  v: 1,
  id: 'a3f9c1de-0000-4000-8000-000000000000',
  app: 'mypri',
  note: 'кадр снимается сверху',
  build: { id: '4b0ab94', time: '2026-08-11T15:10:00Z' },
  createdAt: '2026-08-11T18:12:40+03:00',
  tzOffset: 180,
  route: 'home',
  env: {
    viewport: { w: 393, h: 759 },
    dpr: 3,
    screen: { w: 393, h: 852 },
    ua: 'Mozilla/5.0 (iPhone)',
    language: 'ru-RU',
    online: true,
    client: { platform: 'ios', version: '8.0', telegram: true },
    flags: { demo: false, guest: false, pwa: false },
  },
  snapshot: { priorities: 7 },
  log: [{ at: -1240, kind: 'error', text: '[storage] операции не записались' }],
  target: { path: 'div.app > button.prow__plus', html: '<button class="prow__plus">…</button>' },
  shot: {
    mime: 'image/webp',
    w: 920,
    h: 1180,
    bytes: 86_016,
    crop: { x: 0, y: 120, w: 460, h: 590 },
    strokes: 3,
  },
};

const row = (patch: Record<string, unknown> = {}) => ({
  id: payload.id,
  telegram_id: 246112464,
  app: 'mypri',
  status: 'open',
  note: 'кадр снимается сверху',
  payload: JSON.stringify(payload),
  build_id: '4b0ab94',
  route: 'home',
  shot_key: 'shot/2026-08/x.webp',
  shot_mime: 'image/webp',
  created_at: '2026-08-11 15:12:40',
  ...patch,
});

describe('тикет в markdown', () => {
  it('начинается с жалобы, а не со сборки', () => {
    // Модель читает сверху вниз: полезное должно стоять выше, а не быть
    // аккуратно уложенным в конец.
    const text = renderTicket(row(), 'shot.webp');
    const note = text.indexOf('кадр снимается сверху');
    const ua = text.indexOf('Mozilla');
    expect(note).toBeGreaterThan(0);
    expect(note).toBeLessThan(ua);
  });

  it('называет отправителя', () => {
    // Тикетов от тестировщиков будет больше, чем своих, и «кто это прислал» —
    // первый вопрос при разборе.
    expect(renderTicket(row(), 'shot.webp')).toContain('246112464');
  });

  it('содержит все обязательные разделы', () => {
    const text = renderTicket(row(), 'shot.webp');
    for (const heading of ['## Куда ткнули', '## Журнал перед отправкой', '## Состояние', '## Окружение']) {
      expect(text).toContain(heading);
    }
  });

  it('кадр подставлен относительной ссылкой', () => {
    // Абсолютный путь сломался бы при чтении тикета из другого каталога.
    expect(renderTicket(row(), 'shot.webp')).toContain('![кадр](./shot.webp)');
  });

  it('без кадра пишет причину, а не пустую картинку', () => {
    const broken = { ...payload, shot: undefined, shotError: 'import-failed' };
    const text = renderTicket(row({ payload: JSON.stringify(broken), shot_key: null }), undefined);
    expect(text).not.toContain('![кадр]');
    expect(text).toContain('офлайн');
  });

  it('молчание приложения выносится отдельной строкой', () => {
    // «Приложение не ответило» — это почти всегда и есть тот баг, ради которого
    // тикет заведён.
    const silent = { ...payload, hostError: 'snapshot: стора уже нет' };
    expect(renderTicket(row({ payload: JSON.stringify(silent) }), 'shot.webp')).toContain('стора уже нет');
  });

  it('показывает команду закрытия с коротким номером', () => {
    expect(renderTicket(row(), 'shot.webp')).toContain('tickets:close -- a3f9c1de');
  });

  it('пустой журнал не ломает разметку', () => {
    const quiet = { ...payload, log: [] };
    expect(renderTicket(row({ payload: JSON.stringify(quiet) }), 'shot.webp')).toContain('Пусто.');
  });
});

describe('куда ложится тикет', () => {
  const base = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'tickets-'));

  const put = (dir: string, name: string, id: string): void => {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
    fs.writeFileSync(path.join(dir, name, 'payload.json'), JSON.stringify({ id }));
  };

  it('обычный тикет — восемь символов', () => {
    const dir = base();
    expect(folderFor('a3f9c1de-1111-4000-8000-000000000001', dir).name).toBe('a3f9c1de');
  });

  it('уже выгруженный узнаёт себя и не качается заново', () => {
    const dir = base();
    put(dir, 'a3f9c1de', 'a3f9c1de-1111-4000-8000-000000000001');
    expect(folderFor('a3f9c1de-1111-4000-8000-000000000001', dir).already).toBe(true);
  });

  it('совпавшее начало берёт имя длиннее, а не пропадает', () => {
    /*
     * Ровно эта ошибка и нашлась при первой сквозной проверке: второй тикет с
     * тем же началом молча не выгружался — каталог первого принимался за него.
     */
    const dir = base();
    put(dir, 'a3f9c1de', 'a3f9c1de-1111-4000-8000-000000000001');

    const other = folderFor('a3f9c1de-2222-4000-8000-000000000002', dir);
    expect(other.already).toBe(false);
    expect(other.name).toBe('a3f9c1de-222');
  });

  it('каталог без payload.json своим не считается', () => {
    // Недокачанный тикет должен выгрузиться заново, а не остаться половиной.
    const dir = base();
    fs.mkdirSync(path.join(dir, 'a3f9c1de'));
    expect(folderFor('a3f9c1de-1111-4000-8000-000000000001', dir).name).toBe('a3f9c1de-111');
  });
});

describe('разбор .env.local', () => {
  it('читает пары, пропуская комментарии и пустые строки', () => {
    const values = parseEnvFile('# комментарий\n\nDEVKIT_URL=https://x\nDEVKIT_TOKEN=abc\n');
    expect(values).toEqual({ DEVKIT_URL: 'https://x', DEVKIT_TOKEN: 'abc' });
  });

  it('снимает кавычки', () => {
    expect(parseEnvFile('A="раз"\nB=\'два\'').A).toBe('раз');
    expect(parseEnvFile('A="раз"\nB=\'два\'').B).toBe('два');
  });

  it('значение со знаком равенства не режется пополам', () => {
    // Токены base64 вполне могут содержать «=» на конце.
    expect(parseEnvFile('T=abc==').T).toBe('abc==');
  });

  it('строку без равенства пропускает молча', () => {
    expect(parseEnvFile('мусор\nA=1')).toEqual({ A: '1' });
  });
});
