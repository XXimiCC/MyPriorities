import { beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_DRAFTS,
  MAX_TRIES,
  delayDraft,
  dropDraft,
  dueDrafts,
  evictFor,
  expired,
  keepDraft,
  memoryOutboxForTests,
  nextAttemptAt,
  resetOutboxForTests,
  TTL_MS,
  type Draft,
} from './outbox';
import type { TicketPayload } from './types';

const ticket = (id: string): TicketPayload => ({
  v: 1,
  id,
  app: 'mypri',
  note: 'не работает',
  build: { id: 'abc', time: '' },
  createdAt: '2026-08-11T18:00:00+03:00',
  tzOffset: 180,
  route: 'home',
  env: {
    viewport: { w: 393, h: 759 },
    dpr: 3,
    screen: { w: 393, h: 852 },
    ua: '',
    language: 'ru',
    online: false,
    client: {},
    flags: {},
  },
  log: [],
});

const draft = (id: string, patch: Partial<Draft> = {}): Draft => ({
  id,
  createdAt: 1000,
  ticket: ticket(id),
  tries: 0,
  nextAt: 0,
  ...patch,
});

beforeEach(() => {
  resetOutboxForTests(memoryOutboxForTests());
});

describe('черновик', () => {
  it('кладётся и достаётся целиком', async () => {
    await keepDraft(draft('a'));
    const due = await dueDrafts(2000);
    expect(due).toHaveLength(1);
    expect(due[0]?.ticket.note).toBe('не работает');
  });

  it('удалённый больше не отдаётся', async () => {
    await keepDraft(draft('a'));
    await dropDraft('a');
    expect(await dueDrafts(2000)).toHaveLength(0);
  });

  it('не подошедший по времени ждёт', async () => {
    await keepDraft(draft('a', { nextAt: 5000 }));
    expect(await dueDrafts(2000)).toHaveLength(0);
    expect(await dueDrafts(6000)).toHaveLength(1);
  });

  it('протухший выбрасывается, а не копится', async () => {
    await keepDraft(draft('a', { createdAt: 0 }));
    expect(await dueDrafts(TTL_MS + 1)).toHaveLength(0);
    // И именно выбрасывается: следующий проход его тоже не увидит.
    expect(await dueDrafts(0)).toHaveLength(0);
  });

  it('протухание считается от дня сборки', () => {
    expect(expired(draft('a', { createdAt: 0 }), TTL_MS - 1)).toBe(false);
    expect(expired(draft('a', { createdAt: 0 }), TTL_MS + 1)).toBe(true);
  });
});

describe('вытеснение', () => {
  it('при переполнении уходит самый старый', () => {
    const kept = Array.from({ length: MAX_DRAFTS }, (_, index) =>
      draft(`d${index}`, { createdAt: index }),
    );
    expect(evictFor(kept, 0)).toEqual(['d0']);
  });

  it('пока есть место, не выселяет никого', () => {
    expect(evictFor([draft('a')], 0)).toEqual([]);
  });

  it('тяжёлые кадры вытесняют раньше, чем кончится счёт', () => {
    // Инструмент отладки не имеет права стать причиной, по которой на телефоне
    // кончилось место.
    const heavy = (id: string, at: number): Draft =>
      draft(id, { createdAt: at, shot: new Blob(['x'.repeat(1_400_000)]) });
    expect(evictFor([heavy('a', 1), heavy('b', 2)], 1_400_000)).toEqual(['a']);
  });
});

describe('повторные попытки', () => {
  it('отступ растёт, но не бесконечно', () => {
    expect(nextAttemptAt(0, 0)).toBe(0);
    expect(nextAttemptAt(1, 0)).toBeGreaterThan(0);
    expect(nextAttemptAt(2, 0)).toBeGreaterThan(nextAttemptAt(1, 0));
    expect(nextAttemptAt(99, 0)).toBe(nextAttemptAt(3, 0));
  });

  it('неудача откладывает, а не теряет', async () => {
    await keepDraft(draft('a'));
    await delayDraft(draft('a'), 1000, 'сеть');

    expect(await dueDrafts(1000)).toHaveLength(0);
    const later = await dueDrafts(1000 + 60_000);
    expect(later[0]?.tries).toBe(1);
    expect(later[0]?.lastError).toBe('сеть');
  });

  it('безнадёжный отчёт не живёт вечно', async () => {
    await keepDraft(draft('a', { tries: MAX_TRIES - 1 }));
    await delayDraft(draft('a', { tries: MAX_TRIES - 1 }), 1000, 'сервер 500');
    expect(await dueDrafts(Number.MAX_SAFE_INTEGER)).toHaveLength(0);
  });
});
