import { describe, expect, it } from 'vitest';

import { browserFacts, buildTicket, freezeContext, localIso, newTicketId, type BrowserFacts } from './context';
import { registerDevkitHost } from './host';
import type { DevkitHost } from './types';

const facts = (): BrowserFacts => ({
  viewport: { w: 393, h: 759 },
  dpr: 3,
  screen: { w: 393, h: 852 },
  ua: 'Mozilla/5.0 (iPhone)',
  language: 'ru-RU',
  online: true,
  now: new Date(2026, 7, 11, 18, 12, 40),
});

const host = (patch: Partial<DevkitHost> = {}): DevkitHost => ({
  endpoint: 'https://example',
  app: 'mypri',
  build: { id: '4b0ab94', time: '2026-08-11T15:10:00Z' },
  route: () => 'home',
  client: () => ({ platform: 'ios', telegram: true }),
  flags: () => ({ demo: false }),
  snapshot: () => ({ priorities: 7, title: 'Терапия' }),
  ...patch,
});

describe('снимок момента', () => {
  it('собирает обязательные поля', () => {
    registerDevkitHost(host());

    const frozen = freezeContext({ facts: facts(), log: [] });

    expect(frozen.app).toBe('mypri');
    expect(frozen.route).toBe('home');
    expect(frozen.build.id).toBe('4b0ab94');
    expect(frozen.env.dpr).toBe(3);
    expect(frozen.env.client).toEqual({ platform: 'ios', telegram: true });
    expect(frozen.hostError).toBeUndefined();
  });

  it('снимок состояния проходит вычистку', () => {
    // Правило «только числа» записано в devkitHost.ts, но соблюдается здесь.
    registerDevkitHost(host());
    expect(freezeContext({ facts: facts(), log: [] }).snapshot).toEqual({ priorities: 7 });
  });

  it('упавший вызов хозяина не роняет сборку', () => {
    registerDevkitHost(
      host({
        snapshot: () => {
          throw new Error('стора уже нет');
        },
      }),
    );

    const frozen = freezeContext({ facts: facts(), log: [] });

    expect(frozen.snapshot).toBeUndefined();
    expect(frozen.hostError).toContain('стора уже нет');
    // Самое важное: всё остальное на месте — это и есть тикет о белом экране.
    expect(frozen.route).toBe('home');
  });

  it('хозяин без необязательных полей не роняет сборку', () => {
    registerDevkitHost({ endpoint: 'https://example', app: 'other', build: { id: 'x', time: '' } });

    const frozen = freezeContext({ facts: facts(), log: [] });

    expect(frozen.route).toBe('—');
    expect(frozen.env.flags).toEqual({});
    expect(frozen.hostError).toBeUndefined();
  });
});

describe('местное время', () => {
  it('пишется со смещением, а не в UTC', () => {
    const stamp = localIso(new Date(2026, 7, 11, 18, 12, 40));
    expect(stamp).toMatch(/^2026-08-11T18:12:40[+-]\d\d:\d\d$/);
  });
});

describe('тикет', () => {
  it('переносит снятое и добавляет написанное', () => {
    registerDevkitHost(host());
    const frozen = freezeContext({ facts: facts(), log: [{ at: -120, kind: 'error', text: 'упало' }] });

    const ticket = buildTicket(frozen, { id: 'abc', note: 'кнопка не нажимается' });

    expect(ticket.v).toBe(1);
    expect(ticket.id).toBe('abc');
    expect(ticket.note).toBe('кнопка не нажимается');
    expect(ticket.log).toHaveLength(1);
    expect(ticket.shot).toBeUndefined();
    expect(ticket.shotError).toBeUndefined();
  });

  it('причина отсутствия кадра доезжает', () => {
    registerDevkitHost(host());
    const frozen = freezeContext({ facts: facts(), log: [] });

    expect(buildTicket(frozen, { id: 'a', note: '', shotError: 'timeout' }).shotError).toBe('timeout');
  });

  it('идентификаторы не повторяются', () => {
    expect(newTicketId()).not.toBe(newTicketId());
  });
});

describe('факты браузера', () => {
  it('без окна не зовутся', () => {
    // Единственная функция модуля, которой нужен браузер, — и она вынесена
    // отдельно ровно затем, чтобы всё остальное проверялось в node.
    expect(typeof browserFacts).toBe('function');
  });
});
