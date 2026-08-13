import { describe, expect, it } from 'vitest';

import {
  assertShot,
  inviteOf,
  isAllowed,
  isStatus,
  parseAllowList,
  parseTicket,
  readTicket,
  requireDevkitToken,
  updateTicket,
} from '../src/devkit';
import type { Env } from '../src/env';

/* Токен латиницей не для красоты: заголовки HTTP не умеют ничего, кроме
   однобайтных символов, и кириллический токен упал бы ещё до сравнения. */
const env = (patch: Partial<Env> = {}): Env => ({ DEVKIT_TOKEN: 'sEcReT-24', ...patch }) as Env;

const withHeader = (value?: string): Request =>
  new Request('https://mypri.workers.dev/devkit/tickets', {
    headers: value === undefined ? {} : { 'X-Devkit-Token': value },
  });

describe('белый список', () => {
  it('читает номера через запятую, не спотыкаясь о мусор', () => {
    expect([...parseAllowList(' 111, 222 ,, abc, 333 ')]).toEqual([111, 222, 333]);
  });

  it('дубли схлопывает', () => {
    expect(parseAllowList('111,111').size).toBe(1);
  });

  it('пусто и не задано означают «никто»', () => {
    // Закрыто по умолчанию: цена ошибки в эту сторону — чужие кадры экрана.
    expect(parseAllowList('').size).toBe(0);
    expect(parseAllowList(undefined).size).toBe(0);
  });

  it('звёздочка подстановкой не является', () => {
    expect(parseAllowList('*').size).toBe(0);
  });

  it('отрицательные и дробные не проходят', () => {
    expect(parseAllowList('-5, 1.5, 0').size).toBe(0);
  });
});

describe('дверь командной строки', () => {
  it('без токена не пускает', () => {
    expect(() => requireDevkitToken(withHeader(), env())).toThrow(/bad-devkit-token/);
  });

  it('с чужим токеном не пускает', () => {
    expect(() => requireDevkitToken(withHeader('nope'), env())).toThrow(/bad-devkit-token/);
  });

  it('со своим пускает', () => {
    expect(() => requireDevkitToken(withHeader('sEcReT-24'), env())).not.toThrow();
  });

  it('без настройки говорит прямо, а не «не пустили»', () => {
    // «Не настроено» и «не пустили» обязаны различаться, иначе настройка
    // превращается в гадание.
    expect(() => requireDevkitToken(withHeader('anything'), env({ DEVKIT_TOKEN: undefined }))).toThrow(
      /devkit-not-configured/,
    );
  });
});

describe('дверь тестировщика', () => {
  /** База, которая на любой вопрос отвечает «такого профиля нет». */
  const noProfiles = {
    prepare: () => ({ bind: () => ({ first: () => Promise.resolve(null) }) }),
  } as unknown as Env['DB'];

  const withInvite = (value?: string): Request =>
    new Request('https://mypri.workers.dev/devkit/tickets', {
      headers: value === undefined ? {} : { 'X-Devkit-Invite': value },
    });

  it('ключ читается из браузерного заголовка', () => {
    expect(inviteOf(withInvite('link-key'))).toBe('link-key');
    expect(inviteOf(withInvite())).toBeUndefined();
  });

  it('верный ключ пускает и без белого списка', async () => {
    // Собирать у каждого помощника номер Telegram — ровно та возня, из-за
    // которой помогать перестают.
    const env = { DB: noProfiles, DEVKIT_ALLOW: '', DEVKIT_INVITE: 'link-key' } as Env;
    expect(await isAllowed(env, 'user-1', 'link-key')).toBe(true);
  });

  it('чужой ключ не пускает', async () => {
    const env = { DB: noProfiles, DEVKIT_ALLOW: '', DEVKIT_INVITE: 'link-key' } as Env;
    expect(await isAllowed(env, 'user-1', 'другой')).toBe(false);
  });

  it('без настроенного ключа ссылка не работает вовсе', async () => {
    // Не задан секрет — приглашений не существует, а не «пускаем всех».
    const env = { DB: noProfiles, DEVKIT_ALLOW: '' } as Env;
    expect(await isAllowed(env, 'user-1', 'link-key')).toBe(false);
    expect(await isAllowed(env, 'user-1', '')).toBe(false);
  });
});

describe('поиск тикета по началу номера', () => {
  const dbWith = (rows: Array<{ id: string }>): Env['DB'] =>
    ({
      prepare: () => ({ bind: () => ({ all: () => Promise.resolve({ results: rows }) }) }),
    }) as unknown as Env['DB'];

  it('одно совпадение — берётся оно', async () => {
    const row = { id: 'a3f9c1de-1111' };
    await expect(readTicket({ DB: dbWith([row]) } as Env, 'a3f9c1de')).resolves.toMatchObject(row);
  });

  it('два совпадения — отказ, а не «первый попавшийся»', async () => {
    // Закрыть чужой тикет и никогда об этом не узнать — худший исход из всех.
    const db = dbWith([{ id: 'a3f9c1de-1111' }, { id: 'a3f9c1de-2222' }]);
    await expect(readTicket({ DB: db } as Env, 'a3f9c1de')).rejects.toThrow(/ambiguous-id/);
  });

  it('полный номер сильнее чужого начала', async () => {
    const db = dbWith([{ id: 'a3f9c1de' }, { id: 'a3f9c1de-2222' }]);
    await expect(readTicket({ DB: db } as Env, 'a3f9c1de')).resolves.toMatchObject({ id: 'a3f9c1de' });
  });

  it('ничего не нашлось — 404', async () => {
    await expect(readTicket({ DB: dbWith([]) } as Env, 'zzzz')).rejects.toThrow(/no-ticket/);
  });
});

describe('правка тикета из админки', () => {
  /** База, которая отдаёт один тикет и молча принимает запись. */
  const oneTicket = {
    prepare: () => ({
      bind: () => ({
        all: () => Promise.resolve({ results: [{ id: 'a3f9c1de', status: 'open', note: 'было' }] }),
        run: () => Promise.resolve({}),
      }),
    }),
  } as unknown as Env['DB'];

  it('состояния перечислены явно', () => {
    expect(isStatus('open')).toBe(true);
    expect(isStatus('queued')).toBe(true);
    expect(isStatus('closed')).toBe(true);
    expect(isStatus('wontfix')).toBe(true);
  });

  it('выдуманное состояние не проходит', async () => {
    // Иначе опечатка в запросе тихо увела бы тикет из всех выборок разом.
    expect(isStatus('в работе')).toBe(false);
    expect(isStatus('')).toBe(false);
    expect(isStatus(undefined)).toBe(false);
    await expectReject(() => updateTicket({ DB: oneTicket } as Env, 'a3f9c1de', { status: 'готово' }));
  });

  it('пустое описание не сохраняется', () => {
    // Описание — единственное, по чему тикет находят глазами в списке.
    return expectReject(() => updateTicket({ DB: oneTicket } as Env, 'a3f9c1de', { note: '   ' }));
  });

  it('без правок отдаёт тикет как есть', async () => {
    const row = await updateTicket({ DB: oneTicket } as Env, 'a3f9c1de', {});
    expect(row.status).toBe('open');
  });
});

async function expectReject(run: () => Promise<unknown>): Promise<void> {
  await expect(run()).rejects.toThrow();
}

describe('кадр', () => {
  it('слишком тяжёлый не принимается', () => {
    expect(() => assertShot(2_000_000, 'image/webp')).toThrow(/shot-too-large/);
  });

  it('чужой формат не принимается', () => {
    expect(() => assertShot(1000, 'application/pdf')).toThrow(/bad-shot-type/);
    expect(() => assertShot(1000, 'image/svg+xml')).toThrow(/bad-shot-type/);
  });

  it('свои форматы проходят', () => {
    for (const mime of ['image/webp', 'image/jpeg', 'image/png']) {
      expect(() => assertShot(1000, mime)).not.toThrow();
    }
  });
});

describe('разбор тикета', () => {
  const good = JSON.stringify({
    v: 1,
    id: 'abc-123',
    app: 'mypri',
    note: 'кнопка не нажимается',
    build: { id: '4b0ab94' },
    route: 'home',
  });

  it('вытаскивает то, по чему потом ищут', () => {
    const parsed = parseTicket(good);
    expect(parsed.id).toBe('abc-123');
    expect(parsed.buildId).toBe('4b0ab94');
    expect(parsed.route).toBe('home');
    // Весь контекст остаётся одним JSON: колонка на каждый факт означала бы
    // миграцию на каждый факт.
    expect(parsed.payload).toBe(good);
  });

  it('без идентификатора и приложения не проходит', () => {
    expect(() => parseTicket(JSON.stringify({ app: 'mypri' }))).toThrow(/bad-id/);
    expect(() => parseTicket(JSON.stringify({ id: 'a' }))).toThrow(/bad-app/);
  });

  it('не JSON не проходит', () => {
    expect(() => parseTicket('{')).toThrow(/not-json/);
  });

  it('огромный контекст не проходит', () => {
    const huge = JSON.stringify({ id: 'a', app: 'b', pad: 'x'.repeat(70_000) });
    expect(() => parseTicket(huge)).toThrow(/payload-too-large/);
  });

  it('длинное описание обрезается, а не отвергается', () => {
    // Отвергнуть тикет из-за многословности — худшее, что можно сделать с
    // человеком, который потратил время на отчёт.
    const wordy = JSON.stringify({ id: 'a', app: 'b', note: 'я'.repeat(5000) });
    expect(parseTicket(wordy).note.length).toBe(2000);
  });
});
