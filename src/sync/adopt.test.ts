/**
 * Переход на сервер: что он обязан сохранить.
 *
 * Первый тест здесь — воспроизведение настоящей потери данных на живом
 * устройстве, а не выдуманный случай. Поэтому он написан по шагам того утра, а
 * не по коду: устройство с историей, одно нажатие, уехавшее на сервер, и
 * следующий запуск.
 */

import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptySettings } from '../domain/settings';
import type { SnapshotContents } from '../domain/snapshot';
import { emptyJournal } from '../domain/types';
import { emptySkills } from '../skills/types';
import { opsLog, resetBackendForTests } from '../store/local/db';
import {
  adoptServerState,
  backupBeforeSync,
  restoreBeforeSync,
  somethingToRestore,
} from './adopt';
import type { EngineDeps } from './engine';
import { opsToFill } from './fill';
import { formatStamp } from './hlc';
import type { Op, Stamper } from './ops';
import { TransportError, type PullResult, type SyncDoc, type SyncTransport } from './transport';

/** Метки идут по возрастанию: их порядок и решает споры при слиянии. */
function stamper(device: string): Stamper {
  let wall = 1_770_000_000_000;
  return () => {
    wall += 1;
    return formatStamp({ wall, counter: 0 }, device);
  };
}

/**
 * Общие часы на несколько устройств.
 *
 * Отдельный `stamper` на каждое устройство годится, пока их истории не спорят.
 * Там, где спорят, метки обязаны идти в том же порядке, в каком человек нажимал:
 * снятие на телефоне случилось ПОСЛЕ отметки на компьютере, иначе проверяется
 * не то, что произошло.
 */
function sharedClock(): (device: string) => Stamper {
  let wall = 1_770_000_000_000;
  return (device) => () => {
    wall += 1;
    return formatStamp({ wall, counter: 0 }, device);
  };
}

function fakeServer() {
  const stored: Op[] = [];
  let docs: SyncDoc[] = [];
  let failNext: TransportError | undefined;

  const boom = () => {
    if (!failNext) return;
    const error = failNext;
    failNext = undefined;
    throw error;
  };

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
      boom();
      for (const item of ops) {
        if (!stored.some((existing) => existing.opId === item.opId)) stored.push(item);
      }
      for (const doc of incoming) {
        docs = [...docs.filter((existing) => existing.kind !== doc.kind), doc];
      }
      return { seq: stored.length, accepted: ops.length, rejected: 0 };
    },

    async pull(_access, since) {
      boom();
      const page = stored.slice(since);
      return {
        ops: page,
        docs,
        snapshots: [],
        seq: since + page.length,
        more: false,
      } satisfies PullResult;
    },

    async bootstrap(access) {
      return transport.pull(access, 0);
    },
  };

  return {
    transport,
    stored,
    docsOnServer: () => docs,
    breakNext: (error: TransportError) => {
      failNext = error;
    },
  };
}

function deps(server: ReturnType<typeof fakeServer>, signedIn = true): EngineDeps {
  return {
    transport: server.transport,
    session: async () => (signedIn ? { access: 'токен' } : undefined),
  };
}

/** Устройство, которым пользовались годы: история по дням и заряд. */
function longUsed(): SnapshotContents {
  return {
    settings: { ...emptySettings(), onboarded: true, priorities: [{ id: 'ia', title: 'Работа', colorId: 1 }] },
    journal: {
      clicks: { '2025-11-03': { ia: 4 }, '2026-08-09': { ia: 6 } },
      battery: { '2026-08-09': [[540, 3]] },
    },
    skills: emptySkills(),
    skillClicks: { '2026-08-09': { sk: 2 } },
    awards: { n1: '2025-11-03' },
  };
}

let opSeq = 0;

/** Операция с предсказуемым идентификатором: в проверках их становится много. */
function op(kind: Op['kind'], stamp: Stamper, rest: Partial<Op> = {}): Op {
  opSeq += 1;
  return {
    opId: `3f2504e0-4f89-41d3-9a0c-${String(opSeq).padStart(12, '0')}`,
    kind,
    hlc: stamp(),
    ...rest,
  };
}

function totalBlocks(clicks: Record<string, Record<string, number>>): number {
  return Object.values(clicks).reduce(
    (sum, day) => sum + Object.values(day).reduce((inner, n) => inner + n, 0),
    0,
  );
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetBackendForTests();
});

afterEach(() => {
  resetBackendForTests();
});

describe('переход на сервер', () => {
  it('НЕ ТЕРЯЕТ историю, если на сервере уже что-то есть', async () => {
    /*
     * Ровно тот случай, что случился по-настоящему.
     *
     * Устройство нажало один блок ещё до удачного перехода — операция уехала на
     * сервер сама, обычной отправкой. На следующем запуске сервер оказался «не
     * пуст» собственной же единственной операцией, и прежний код принимал это
     * за «здесь уже есть чья-то история, забираем её и живём ею». История
     * устройства при этом лежит не в журнале, а в прежнем хранилище, и в
     * проекции её нет — то есть годы просто исчезали с экрана.
     */
    const server = fakeServer();
    const stamp = stamper('phone');
    const local = longUsed();

    const tap: Op = {
      opId: '3f2504e0-4f89-41d3-9a0c-000000000001',
      kind: 'blk',
      hlc: stamp(),
      day: '2026-08-10',
      targetId: 'ia',
      amount: 1,
    };
    await opsLog.append([tap]);
    await server.transport.push('токен', [tap], []);
    await opsLog.markSynced([tap]);

    const adopted = await adoptServerState(local, stamp, deps(server));
    expect(adopted).toBeDefined();

    // 4 + 6 из прежнего хранилища и 1 от нажатия — ничего не пропало.
    expect(totalBlocks(adopted!.journal.clicks)).toBe(11);
    expect(adopted!.journal.clicks['2025-11-03']).toEqual({ ia: 4 });
    expect(adopted!.skillClicks['2026-08-09']).toEqual({ sk: 2 });
    expect(adopted!.journal.battery['2026-08-09']).toEqual([[540, 3]]);
    expect(adopted!.awards).toEqual({ n1: '2025-11-03' });
  });

  it('перенесённое из прежнего хранилища доезжает до сервера', async () => {
    /*
     * Ловушка, пойманная проверкой на боевой сборке, а не рассуждением.
     *
     * Перенос кладёт итоги по ячейкам в тот же журнал и сразу помечает
     * доставленными — отправлять абсолютные установки напрямую нельзя, они
     * перебили бы чужие числа. Но разница «своё против собственной проекции»
     * после этого всегда пуста: перенесённое лежит ровно там, где его ищут.
     * Обмен бодро отчитывался «долито 0», а история оставалась на устройстве.
     *
     * Считать надо против сервера, и вот это здесь и проверяется.
     */
    const server = fakeServer();
    const stamp = stamper('phone');
    const local = longUsed();

    const imported = opsToFill(local, { journal: emptyJournal(), skillClicks: {}, awards: {} }, stamp);
    await opsLog.append(imported, 1);
    expect(await opsLog.pending()).toHaveLength(0);

    const adopted = await adoptServerState(local, stamp, deps(server));
    expect(adopted).toBeDefined();
    expect(server.stored.length).toBeGreaterThan(0);
    expect(totalBlocks(adopted!.journal.clicks)).toBe(10);
  });

  it('не затирает историю другого устройства, а складывается с ней', async () => {
    // CloudStorage никогда не работал, поэтому у каждого устройства своя
    // история. Пришедший вторым не должен отменять пришедшего первым.
    const server = fakeServer();
    const first = await adoptServerState(longUsed(), stamper('phone'), deps(server));
    expect(first).toBeDefined();

    resetBackendForTests();
    globalThis.indexedDB = new IDBFactory();

    const other: SnapshotContents = {
      ...longUsed(),
      journal: { clicks: { '2026-01-15': { ia: 5 } }, battery: {} },
      skillClicks: {},
      awards: {},
    };
    const second = await adoptServerState(other, stamper('desktop'), deps(server));
    expect(second).toBeDefined();

    // 4 + 6 с телефона и 5 с компьютера.
    expect(totalBlocks(second!.journal.clicks)).toBe(15);
    expect(second!.journal.clicks['2025-11-03']).toEqual({ ia: 4 });
    expect(second!.journal.clicks['2026-01-15']).toEqual({ ia: 5 });
  });

  it('история не остаётся без имён, когда у устройств разные приоритеты', async () => {
    /*
     * Тоже из живых данных: у телефона и компьютера наборы приоритетов
     * оказались разными — CloudStorage никогда не работал, и каждое устройство
     * заводило их само. Настройки же документ цельный, побеждает один. Без
     * дописывания чужих приоритетов история второго устройства осталась бы на
     * сервере целой, но невидимой: блок есть, показать его не к чему.
     */
    const server = fakeServer();
    const first: SnapshotContents = {
      ...longUsed(),
      settings: {
        ...emptySettings(),
        onboarded: true,
        priorities: [{ id: 'ia', title: 'Работа', colorId: 1 }],
      },
    };
    await adoptServerState(first, stamper('phone'), deps(server));

    resetBackendForTests();
    globalThis.indexedDB = new IDBFactory();

    const second: SnapshotContents = {
      settings: {
        ...emptySettings(),
        onboarded: true,
        priorities: [{ id: 'rm', title: 'Здоровье', colorId: 0 }],
      },
      journal: { clicks: { '2026-01-15': { rm: 5 } }, battery: {} },
      skills: emptySkills(),
      skillClicks: {},
      awards: {},
    };
    const joined = await adoptServerState(second, stamper('desktop'), deps(server));

    expect(joined).toBeDefined();
    const ids = joined!.settings!.priorities.map((item) => item.id);
    expect(ids).toContain('ia');
    expect(ids).toContain('rm');
  });

  it('свой приоритет без истории в чужой список не лезет', async () => {
    // Дописываются только те, на которые есть ссылки: приоритет, которым ни
    // разу не пользовались, ничего не прячет, а лишняя строка в списке — та же
    // потеря, только наоборот.
    const server = fakeServer();
    const first: SnapshotContents = {
      ...longUsed(),
      settings: {
        ...emptySettings(),
        onboarded: true,
        priorities: [{ id: 'ia', title: 'Работа', colorId: 1 }],
      },
    };
    await adoptServerState(first, stamper('phone'), deps(server));

    resetBackendForTests();
    globalThis.indexedDB = new IDBFactory();

    const second: SnapshotContents = {
      settings: {
        ...emptySettings(),
        onboarded: true,
        priorities: [
          { id: 'rm', title: 'Здоровье', colorId: 0 },
          { id: 'zz', title: 'Нетронутый', colorId: 5 },
        ],
      },
      journal: { clicks: { '2026-01-15': { rm: 5 } }, battery: {} },
      skills: emptySkills(),
      skillClicks: {},
      awards: {},
    };
    const joined = await adoptServerState(second, stamper('desktop'), deps(server));

    expect(joined!.settings!.priorities.map((item) => item.id)).toEqual(['ia', 'rm']);
  });

  it('снятое на другом устройстве не воскресает на следующем открытии', async () => {
    /*
     * MYPR-32, ровно по жалобе: на компьютере пять получасов работы, на
     * телефоне один, и перезагрузка компьютера не помогает.
     *
     * Причина в порядке шагов. Обмен идёт первым и приносит снятия с телефона,
     * но доливка сравнивает сервер не с журналом, а со снимком, с которым
     * приложение открылось, — а он про снятия ещё не знает. Разница получается
     * «на сервере не хватает четырёх блоков», и доливка ставит их обратно
     * установкой с более свежей меткой, то есть навсегда. Каждое открытие
     * воскрешало снятое заново и увозило воскресшее на сервер.
     */
    const server = fakeServer();
    const clock = sharedClock();
    const desktop = clock('desktop');
    const phone = clock('phone');
    const day = '2026-09-04';

    // Компьютер: пять блоков и переход заряда, всё уехало на сервер.
    const mine = [
      ...Array.from({ length: 5 }, () =>
        op('blk', desktop, { day, targetId: 'ia', amount: 1 }),
      ),
      op('bat', desktop, { day, minute: 540, level: 3 }),
      op('award', desktop, { day, targetId: 'n1' }),
    ];
    await opsLog.append(mine);
    await server.transport.push('токен', mine, []);
    await opsLog.markSynced(mine);

    // Телефон снимает четыре блока, убирает переход и отметку — компьютер об
    // этом ещё не знает: он открыт и ничего не перечитывал.
    await server.transport.push(
      'токен',
      [
        ...Array.from({ length: 4 }, () => op('blk', phone, { day, targetId: 'ia', amount: -1 })),
        op('batdel', phone, { day, minute: 540 }),
        op('unaward', phone, { targetId: 'n1' }),
      ],
      [],
    );

    // Открытие компьютера: снимок в памяти всё ещё помнит пятёрку.
    const stale: SnapshotContents = {
      settings: {
        ...emptySettings(),
        onboarded: true,
        priorities: [{ id: 'ia', title: 'Работа', colorId: 1 }],
      },
      journal: { clicks: { [day]: { ia: 5 } }, battery: { [day]: [[540, 3]] } },
      skills: emptySkills(),
      skillClicks: {},
      awards: { n1: day },
    };

    const adopted = await adoptServerState(stale, desktop, deps(server));
    expect(adopted).toBeDefined();

    expect(adopted!.journal.clicks[day]).toEqual({ ia: 1 });
    expect(adopted!.journal.battery[day]).toBeUndefined();
    expect(adopted!.awards).toEqual({});

    // И, что важнее, ничего лишнего не уехало обратно на сервер: иначе телефон
    // при следующем чтении получил бы свои же снятия отменёнными.
    expect(adopted!.filled).toBe(0);
    expect(server.stored.some((item) => item.kind === 'blkset')).toBe(false);
  });

  it('чужая прибавка, пришедшая обменом, остаётся чужой', async () => {
    // Обратная сторона той же проверки: сверка не должна ничего терять.
    // Компьютер знает про свой блок, телефон добавил свои — на экране сумма.
    const server = fakeServer();
    const clock = sharedClock();
    const desktop = clock('desktop');
    const phone = clock('phone');
    const day = '2026-09-04';

    const mine = [op('blk', desktop, { day, targetId: 'ia', amount: 1 })];
    await opsLog.append(mine);
    await server.transport.push('токен', mine, []);
    await opsLog.markSynced(mine);

    await server.transport.push(
      'токен',
      [op('blk', phone, { day, targetId: 'ia', amount: 2 })],
      [],
    );

    const stale: SnapshotContents = {
      ...longUsed(),
      journal: { clicks: { [day]: { ia: 1 } }, battery: {} },
      skillClicks: {},
      awards: {},
    };

    const adopted = await adoptServerState(stale, desktop, deps(server));
    expect(adopted!.journal.clicks[day]).toEqual({ ia: 3 });
  });

  it('своё, чего на сервере нет, доливается и после сверки', async () => {
    /*
     * Сверка правит снимок только там, где журнал за время обмена изменился.
     * Перенесённое из прежнего хранилища обмен не трогает — значит оно обязано
     * доехать, даже если рядом что-то снимали на другом устройстве.
     */
    const server = fakeServer();
    const clock = sharedClock();
    const desktop = clock('desktop');
    const phone = clock('phone');
    const day = '2026-09-04';

    const mine = [op('blk', desktop, { day, targetId: 'ia', amount: 3 })];
    await opsLog.append(mine);
    await server.transport.push('токен', mine, []);
    await opsLog.markSynced(mine);
    await server.transport.push(
      'токен',
      [op('blk', phone, { day, targetId: 'ia', amount: -2 })],
      [],
    );

    // Плюс годы из прежнего хранилища, которых на сервере нет вовсе.
    const stale: SnapshotContents = {
      ...longUsed(),
      journal: { clicks: { '2025-11-03': { ia: 4 }, [day]: { ia: 3 } }, battery: {} },
      skillClicks: {},
      awards: {},
    };

    const adopted = await adoptServerState(stale, desktop, deps(server));
    expect(adopted!.journal.clicks['2025-11-03']).toEqual({ ia: 4 });
    expect(adopted!.journal.clicks[day]).toEqual({ ia: 1 });
  });

  it('повторный переход не удваивает счётчики', async () => {
    const server = fakeServer();
    const stamp = stamper('phone');
    const local = longUsed();

    await adoptServerState(local, stamp, deps(server));
    const again = await adoptServerState(local, stamp, deps(server));

    expect(totalBlocks(again!.journal.clicks)).toBe(10);
    expect(again!.filled).toBe(0);
  });

  it('без сети переход не состоялся и ничего не изменил', async () => {
    const server = fakeServer();
    server.breakNext(new TransportError(0, 'offline'));

    expect(await adoptServerState(longUsed(), stamper('phone'), deps(server))).toBeUndefined();
    expect(server.stored).toHaveLength(0);
  });

  it('неудачная попытка не оставляет копию пустоты', async () => {
    /*
     * Ловушка, которую я сам себе и поставил. Копия делается один раз и
     * навсегда. Если снимать её при каждой попытке, то первая же — без сети, на
     * запуске, когда человек ещё ничего не завёл, — запомнит пустоту и займёт
     * место настоящей. Возвращать будет нечего ровно тогда, когда понадобится.
     */
    const server = fakeServer();
    server.breakNext(new TransportError(0, 'offline'));
    await adoptServerState(longUsed(), stamper('phone'), deps(server));
    expect(await backupBeforeSync()).toBeUndefined();

    // И новое устройство, которому терять нечего, копию тоже не заводит.
    const blank: SnapshotContents = {
      settings: emptySettings(),
      journal: { clicks: {}, battery: {} },
      skills: emptySkills(),
      skillClicks: {},
      awards: {},
    };
    await adoptServerState(blank, stamper('fresh'), deps(server));
    expect(await backupBeforeSync()).toBeUndefined();

    // А устройство с историей — заводит.
    await adoptServerState(longUsed(), stamper('phone'), deps(server));
    expect(await backupBeforeSync()).toBeDefined();
  });

  it('копия снимается до перехода и только один раз', async () => {
    const server = fakeServer();
    const stamp = stamper('phone');

    await adoptServerState(longUsed(), stamp, deps(server));
    const saved = await backupBeforeSync();
    expect(saved).toBeDefined();

    // Второй переход не должен подменить копию уже переехавшим состоянием:
    // иначе возвращаться будет некуда.
    await adoptServerState({ ...longUsed(), journal: { clicks: {}, battery: {} } }, stamp, deps(server));
    expect(await backupBeforeSync()).toBe(saved);
  });
});

describe('возврат к тому, что было до переезда', () => {
  it('возвращает историю, потерянную прежним переходом', async () => {
    const server = fakeServer();
    const stamp = stamper('phone');
    const local = longUsed();

    // Переход состоялся — копия снята.
    await adoptServerState(local, stamp, deps(server));

    // Изображаем беду: журнал устройства опустел, на экране пусто.
    await opsLog.clear();
    expect(await opsLog.all()).toHaveLength(0);

    const back = await restoreBeforeSync(stamp, deps(server));
    expect(back).toBeDefined();
    expect(totalBlocks(back!.journal.clicks)).toBe(10);
    expect(back!.settings?.priorities).toHaveLength(1);
  });

  it('два пострадавших устройства возвращают своё, и оба остаются целы', async () => {
    /*
     * Ради этого возврат сделан доливкой, а не заменой. С барьером «как было»
     * второй нажавший кнопку стирал бы то, что вернул первый, — и человек
     * ходил бы между устройствами по кругу, каждый раз теряя другую половину.
     */
    const server = fakeServer();
    const desktopHistory: SnapshotContents = {
      ...longUsed(),
      journal: { clicks: { '2026-01-15': { ia: 5 } }, battery: {} },
      skillClicks: {},
      awards: {},
    };

    const asPhone = async () => {
      resetBackendForTests();
      globalThis.indexedDB = new IDBFactory();
      await adoptServerState(longUsed(), stamper('phone'), deps(server));
      return restoreBeforeSync(stamper('phone'), deps(server));
    };
    const asDesktop = async () => {
      resetBackendForTests();
      globalThis.indexedDB = new IDBFactory();
      await adoptServerState(desktopHistory, stamper('desktop'), deps(server));
      return restoreBeforeSync(stamper('desktop'), deps(server));
    };

    await asPhone();
    const back = await asDesktop();

    expect(back).toBeDefined();
    expect(back!.journal.clicks['2025-11-03']).toEqual({ ia: 4 });
    expect(back!.journal.clicks['2026-01-15']).toEqual({ ia: 5 });
    expect(totalBlocks(back!.journal.clicks)).toBe(15);

    // И возврат на телефоне после этого не отменяет вернувшееся на компьютере.
    const andBack = await asPhone();
    expect(totalBlocks(andBack!.journal.clicks)).toBe(15);
  });

  it('без копии возвращать нечего', async () => {
    const server = fakeServer();
    expect(await restoreBeforeSync(stamper('phone'), deps(server))).toBeUndefined();
  });

  it('предлагается только пока есть что возвращать', async () => {
    /*
     * Кнопка, обещающая уже сделанное, пугает не меньше пропажи данных.
     * Поэтому спрашиваем не «есть ли копия» — она остаётся навсегда, — а «есть
     * ли в ней то, чего сейчас нет».
     */
    const server = fakeServer();
    const stamp = stamper('phone');
    const local = longUsed();
    const empty: SnapshotContents = {
      settings: emptySettings(),
      journal: { clicks: {}, battery: {} },
      skills: emptySkills(),
      skillClicks: {},
      awards: {},
    };

    await adoptServerState(local, stamp, deps(server));
    // Всё на месте — предлагать нечего.
    expect(await somethingToRestore(local)).toBe(false);

    // Данные пропали — предлагаем.
    expect(await somethingToRestore(empty)).toBe(true);

    // Вернули — снова нечего.
    const back = await restoreBeforeSync(stamp, deps(server));
    expect(
      await somethingToRestore({
        ...local,
        settings: back!.settings!,
        journal: back!.journal,
        skillClicks: back!.skillClicks,
        awards: back!.awards,
      }),
    ).toBe(false);
  });

  it('снятое вручную достижение кнопку не держит', async () => {
    // Иначе она осталась бы на экране навсегда у любого, кто убрал отметку.
    const server = fakeServer();
    const local = longUsed();
    await adoptServerState(local, stamper('phone'), deps(server));

    expect(await somethingToRestore({ ...local, awards: {} })).toBe(false);
  });
});
