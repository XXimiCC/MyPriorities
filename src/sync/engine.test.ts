import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { opsLog, resetBackendForTests } from '../store/local/db';
import { seedServer, serverIsEmpty, syncOnce, type EngineDeps } from './engine';
import { formatStamp } from './hlc';
import type { Op } from './ops';
import { TransportError, type PullResult, type SyncDoc, type SyncTransport } from './transport';

const DAY = '2026-08-06';
let counter = 0;

function op(at: number): Op {
  counter += 1;
  return {
    opId: `3f2504e0-4f89-41d3-9a0c-${String(counter).padStart(12, '0')}`,
    kind: 'blk',
    hlc: formatStamp({ wall: at, counter: 0 }, 'aaaa1111'),
    day: DAY,
    targetId: 'ab',
    amount: 1,
  };
}

/**
 * Сервер в памяти: хранит операции по порядку прихода и раздаёт их по курсору.
 * Ровно та модель, что у настоящего, — большего движку знать не нужно.
 */
function fakeServer() {
  const stored: Op[] = [];
  let docs: SyncDoc[] = [];
  const pushed: Op[][] = [];
  let failNext: TransportError | undefined;
  let pageSize = 1000;

  const transport: SyncTransport = {
    configured: true,
    login: async () => {
      throw new Error('не используется');
    },
    refresh: async () => {
      throw new Error('не используется');
    },
    logout: async () => {},
    version: async () => 'test',

    async push(_access, ops, incoming) {
      if (failNext) {
        const error = failNext;
        failNext = undefined;
        throw error;
      }
      pushed.push(ops);
      for (const item of ops) {
        if (!stored.some((existing) => existing.opId === item.opId)) stored.push(item);
      }
      if (incoming.length > 0) docs = incoming;
      return { seq: stored.length, accepted: ops.length, rejected: 0 };
    },

    async pull(_access, since) {
      if (failNext) {
        const error = failNext;
        failNext = undefined;
        throw error;
      }
      const page = stored.slice(since, since + pageSize);
      return {
        ops: page,
        docs,
        seq: since + page.length,
        more: since + page.length < stored.length,
      } satisfies PullResult;
    },

    async bootstrap(access) {
      return transport.pull(access, 0);
    },
  };

  return {
    transport,
    stored,
    pushed,
    docsOnServer: () => docs,
    breakNext: (error: TransportError) => {
      failNext = error;
    },
    setPageSize: (size: number) => {
      pageSize = size;
    },
  };
}

function deps(server: ReturnType<typeof fakeServer>, signedIn = true): EngineDeps {
  return {
    transport: server.transport,
    session: async () => (signedIn ? { access: 'токен' } : undefined),
  };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetBackendForTests();
});

afterEach(() => {
  resetBackendForTests();
});

describe('обмен операциями', () => {
  it('отдаёт накопленное и помечает доставленным', async () => {
    const server = fakeServer();
    await opsLog.append([op(1), op(2)]);

    const outcome = await syncOnce(deps(server));
    expect(outcome.ok).toBe(true);
    expect(outcome.pushed).toBe(2);
    expect(server.stored).toHaveLength(2);
    expect(await opsLog.pending()).toHaveLength(0);
  });

  it('чужое приезжает и в журнал, и в ответ', async () => {
    const server = fakeServer();
    const theirs = op(5);
    server.stored.push(theirs);

    const outcome = await syncOnce(deps(server));
    expect(outcome.pulled).toBe(1);
    expect((await opsLog.all()).map((row) => row.opId)).toContain(theirs.opId);
    // Пришедшее уже на сервере — отправлять обратно незачем.
    expect(await opsLog.pending()).toHaveLength(0);
  });

  it('без сессии не делает ничего и не шумит', async () => {
    const server = fakeServer();
    await opsLog.append([op(1)]);

    const outcome = await syncOnce(deps(server, false));
    expect(outcome.ok).toBe(false);
    expect(server.stored).toHaveLength(0);
    // Операция осталась в очереди: не отдали — значит, отдадим потом.
    expect(await opsLog.pending()).toHaveLength(1);
  });

  it('обрыв связи не теряет очередь', async () => {
    const server = fakeServer();
    await opsLog.append([op(1), op(2)]);
    server.breakNext(new TransportError(0, 'offline'));

    const failed = await syncOnce(deps(server));
    expect(failed.ok).toBe(false);
    expect(await opsLog.pending()).toHaveLength(2);

    // Сеть вернулась — уходит всё накопленное.
    const ok = await syncOnce(deps(server));
    expect(ok.pushed).toBe(2);
    expect(await opsLog.pending()).toHaveLength(0);
  });

  it(
    'накопленное за долгий оффлайн уходит целиком',
    async () => {
      // Семьсот — это две пачки при потолке в пятьсот: ровно столько, чтобы
      // проверить сам цикл. Запас по времени щедрый не от медленного кода, а
      // от объёма ввода-вывода: fake-indexeddb на сотнях записей неспешен, и
      // под общей нагрузкой пять секунд по умолчанию не выдерживаются.
      const server = fakeServer();
      await opsLog.append(Array.from({ length: 700 }, (_, i) => op(i + 1)));

      const outcome = await syncOnce(deps(server));
      expect(outcome.pushed).toBe(700);
      expect(server.stored).toHaveLength(700);
      // Пачками, а не одним куском: у сервера потолок на запрос.
      expect(server.pushed.length).toBe(2);
    },
    20_000,
  );

  it('длинный хвост чужих операций дочитывается страницами', async () => {
    const server = fakeServer();
    server.setPageSize(10);
    for (let i = 0; i < 45; i += 1) server.stored.push(op(i + 1));

    const outcome = await syncOnce(deps(server));
    expect(outcome.pulled).toBe(45);
  });

  it('повторный заход ничего не тянет заново', async () => {
    const server = fakeServer();
    server.stored.push(op(1), op(2));

    expect((await syncOnce(deps(server))).pulled).toBe(2);
    // Курсор запомнен: второй заход по той же сети возвращается пустым.
    expect((await syncOnce(deps(server))).pulled).toBe(0);
  });

  it('своя операция, вернувшаяся с сервера, не удваивается', async () => {
    const server = fakeServer();
    const mine = op(1);
    await opsLog.append([mine]);

    await syncOnce(deps(server));
    // Сбрасываем курсор, как будто читаем с нуля на том же устройстве.
    await opsLog.setMeta('cursor', 0);
    await syncOnce(deps(server));

    expect(await opsLog.all()).toHaveLength(1);
  });

  it('документы с сервера приходят наверх', async () => {
    const server = fakeServer();
    await seedServer([], [{ kind: 'settings', body: '{"version":1}', hlc: 'x' }], deps(server));
    await opsLog.setMeta('cursor', 0);

    const outcome = await syncOnce(deps(server));
    expect(outcome.docs).toEqual([{ kind: 'settings', body: '{"version":1}', hlc: 'x' }]);
  });
});

describe('засев сервера', () => {
  it('заменяет журнал итогами и отправляет их', async () => {
    /*
     * Журнал начали вести недавно, а история копилась годами — в нём только
     * хвост. Поэтому засев не отправляет накопленное, а заменяет его итогами.
     */
    const server = fakeServer();
    await opsLog.append([op(1), op(2)]);

    const totals = [op(10), op(11), op(12)];
    expect(await seedServer(totals, [], deps(server))).toBe(true);

    expect(server.stored).toHaveLength(3);
    expect(await opsLog.all()).toHaveLength(3);
  });

  it('пустой сервер отличается от непустого', async () => {
    const server = fakeServer();
    expect(await serverIsEmpty(deps(server))).toBe(true);

    server.stored.push(op(1));
    expect(await serverIsEmpty(deps(server))).toBe(false);
  });

  it('не дозвонились — не знаем, а не «пусто»', async () => {
    // Засев по догадке затёр бы чужую историю. Лучше отложить.
    const server = fakeServer();
    server.breakNext(new TransportError(0, 'offline'));
    expect(await serverIsEmpty(deps(server))).toBeUndefined();
  });
});
