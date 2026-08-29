import { describe, expect, it } from 'vitest';

import { emptySettings } from '../domain/settings';
import { emptyJournal, timelessMarks, type MarkTime } from '../domain/types';
import { emptySkills } from '../skills/types';
import { reduce, type Action, type State } from '../store/reduce';
import { createClock, emptyHlc } from './hlc';
import type { Op } from './ops';
import { emptyBase, project } from './project';
import { isRecordable, opsForContents, recordOps } from './record';

const DAY = '2026-08-06';
const OTHER = '2026-08-05';

function emptyState(): State {
  return {
    ready: true,
    settings: emptySettings(),
    journal: emptyJournal(),
    skills: emptySkills(),
    skillClicks: {},
    awards: {},
    fresh: [],
    skillsLoaded: true,
  };
}

/**
 * Прогоняет действия и через reducer, и через журнал.
 *
 * Это и есть условие двойной записи: пока источником истины остаётся
 * CloudStorage, проекция обязана давать ровно то же, что состояние. Разойдись
 * они — и переключение на журнал в шестом этапе тихо изменило бы историю.
 */
function run(actions: Action[], from: State = emptyState()) {
  const clock = createClock('aaaa1111', emptyHlc());
  const stamp = (): string => clock.stamp();
  const ops: Op[] = [];

  let state = from;
  for (const action of actions) {
    if (isRecordable(action)) ops.push(...recordOps(state, action, stamp));
    state = reduce(state, action);
  }
  return { state, ops, projected: project(emptyBase(), ops) };
}

/**
 * Счётчик равен длине стека — в каждой ячейке и с обеих сторон.
 *
 * Это тот самый инвариант, на котором держится снятие: «−» убирает последнюю
 * отметку стека, и лишний блок в счётчике означал бы, что снимается не та.
 */
function expectStackMatchesCount(journal: State['journal'], where: string): void {
  for (const [day, entry] of Object.entries(journal.clicks)) {
    for (const [id, count] of Object.entries(entry)) {
      expect(journal.marks[day]?.[id] ?? [], `${where}: ${day} ${id}`).toHaveLength(count);
    }
  }
  for (const [day, entry] of Object.entries(journal.marks)) {
    for (const [id, stack] of Object.entries(entry)) {
      expect(journal.clicks[day]?.[id] ?? 0, `${where}: ${day} ${id}`).toBe(stack.length);
    }
  }
}

function expectAgreement(actions: Action[], from?: State): void {
  const { state, projected } = run(actions, from);
  expect(projected.journal.clicks).toEqual(state.journal.clicks);
  expect(projected.journal.marks).toEqual(state.journal.marks);
  expect(projected.journal.battery).toEqual(state.journal.battery);
  expect(projected.skillClicks).toEqual(state.skillClicks);
  expect(projected.awards).toEqual(state.awards);

  expectStackMatchesCount(state.journal, 'состояние');
  expectStackMatchesCount(projected.journal, 'проекция');
}

describe('журнал сходится с состоянием', () => {
  it('на блоках', () => {
    expectAgreement([
      { type: 'blocks', day: DAY, priorityId: 'ab', delta: 1 },
      { type: 'blocks', day: DAY, priorityId: 'ab', delta: 1 },
      { type: 'blocks', day: DAY, priorityId: 'cd', delta: 1 },
      { type: 'blocks', day: DAY, priorityId: 'ab', delta: -1 },
    ]);
  });

  it('на блоках со временем нажатия', () => {
    // Живое нажатие и воспроизведение журнала обязаны дать один и тот же стек:
    // иначе «−» снимало бы разные отметки до и после перезагрузки.
    const { state } = run([
      { type: 'blocks', day: DAY, priorityId: 'ab', delta: 1, minute: 725 },
      { type: 'blocks', day: DAY, priorityId: 'ab', delta: 1, minute: 820 },
      // Дописанный прошлый день времени не получает: отмечали его не в тот день.
      { type: 'blocks', day: OTHER, priorityId: 'ab', delta: 1 },
      { type: 'blocks', day: DAY, priorityId: 'ab', delta: 1, minute: 910 },
      { type: 'blocks', day: DAY, priorityId: 'ab', delta: -1 },
    ]);

    expect(state.journal.marks[DAY]).toEqual({ ab: [725, 820] });
    expect(state.journal.marks[OTHER]).toEqual({ ab: [null] });

    expectAgreement([
      { type: 'blocks', day: DAY, priorityId: 'ab', delta: 1, minute: 725 },
      { type: 'blocks', day: DAY, priorityId: 'ab', delta: 1, minute: 820 },
      { type: 'blocks', day: OTHER, priorityId: 'ab', delta: 1 },
      { type: 'blocks', day: DAY, priorityId: 'ab', delta: 1, minute: 910 },
      { type: 'blocks', day: DAY, priorityId: 'ab', delta: -1 },
    ]);
  });

  it('снятие времени не несёт', () => {
    // Снятие ничего не отмечает — оно убирает последнюю отметку, и своего
    // времени у него нет. Минута в такой операции была бы враньём в журнале.
    const { ops } = run([
      { type: 'blocks', day: DAY, priorityId: 'ab', delta: 1, minute: 725 },
      { type: 'blocks', day: DAY, priorityId: 'ab', delta: -1, minute: 800 },
    ]);
    expect(ops.map((op) => [op.amount, op.minute])).toEqual([
      [1, 725],
      [-1, undefined],
    ]);
  });

  it('когда снимают блок с пустой ячейки', () => {
    /*
     * Состояние обрезано снизу нулём и не меняется. Записать при этом «−1»
     * значило бы развести журнал с памятью: следующее добавление дало бы 1 в
     * состоянии и 0 в проекции.
     */
    const { ops } = run([{ type: 'blocks', day: DAY, priorityId: 'ab', delta: -1 }]);
    expect(ops).toHaveLength(0);

    expectAgreement([
      { type: 'blocks', day: DAY, priorityId: 'ab', delta: -1 },
      { type: 'blocks', day: DAY, priorityId: 'ab', delta: -1 },
      { type: 'blocks', day: DAY, priorityId: 'ab', delta: 1 },
    ]);
  });

  it('на навыках', () => {
    expectAgreement([
      { type: 'skill-blocks', day: DAY, skillId: 'g1', delta: 3 },
      { type: 'skill-blocks', day: DAY, skillId: 'g1', delta: -1 },
      { type: 'skill-blocks', day: OTHER, skillId: 'g1', delta: 2 },
    ]);
  });

  it('на переходах заряда', () => {
    expectAgreement([
      { type: 'battery-set', day: DAY, minute: 480, level: 3 },
      { type: 'battery-set', day: DAY, minute: 900, level: 2 },
      { type: 'battery-set', day: DAY, minute: 1200, level: 1 },
    ]);
  });

  it('когда отметку переставляют по времени', () => {
    expectAgreement([
      { type: 'battery-set', day: DAY, minute: 900, level: 1 },
      { type: 'battery-set', day: DAY, minute: 960, level: 1, replace: 900 },
    ]);
  });

  it('когда отметку снимают', () => {
    expectAgreement([
      { type: 'battery-set', day: DAY, minute: 480, level: 3 },
      { type: 'battery-set', day: DAY, minute: 900, level: 2 },
      { type: 'battery-remove', day: DAY, minute: 480 },
    ]);
  });

  it('когда уровень на той же минуте меняют', () => {
    expectAgreement([
      { type: 'battery-set', day: DAY, minute: 900, level: 1 },
      { type: 'drain', day: DAY, drainedBy: 'ab' },
      // Смена уровня стирает ответ о расходе: у полного заряда причины разряда
      // быть не может. Журнал обязан стереть его тоже.
      { type: 'battery-set', day: DAY, minute: 900, level: 4 },
    ]);
  });

  it('на ответе о расходе', () => {
    expectAgreement([
      { type: 'battery-set', day: DAY, minute: 900, level: 1 },
      { type: 'drain', day: DAY, drainedBy: '!дорога домой' },
    ]);
  });

  it('когда ответ приходит уже назавтра', () => {
    // Вопрос задан вчера в 23:59, отвечают сегодня в 00:01: ответ должен лечь
    // на вчерашний переход, и журнал ищет его теми же правилами, что reducer.
    const { state, projected } = run([
      { type: 'battery-set', day: OTHER, minute: 1439, level: 1 },
      { type: 'drain', day: DAY, drainedBy: 'ab' },
    ]);
    expect(state.journal.battery[OTHER]).toEqual([[1439, 1, 'ab']]);
    expect(projected.journal.battery).toEqual(state.journal.battery);
  });

  it('на достижениях', () => {
    expectAgreement([
      { type: 'awards', awards: { s1: DAY }, fresh: ['s1'] },
      { type: 'awards', awards: { s1: DAY, h1: DAY }, fresh: ['h1'] },
      { type: 'awards', awards: { h1: DAY }, fresh: [] },
    ]);
  });

  it('на всём вперемешку', () => {
    expectAgreement([
      { type: 'blocks', day: OTHER, priorityId: 'ab', delta: 4 },
      { type: 'battery-set', day: OTHER, minute: 600, level: 3 },
      { type: 'skill-blocks', day: OTHER, skillId: 'g1', delta: 2 },
      { type: 'awards', awards: { s1: OTHER }, fresh: ['s1'] },
      { type: 'blocks', day: DAY, priorityId: 'cd', delta: 1 },
      { type: 'blocks', day: OTHER, priorityId: 'ab', delta: -2 },
      { type: 'battery-set', day: DAY, minute: 1000, level: 1 },
      { type: 'drain', day: DAY, drainedBy: '?' },
      { type: 'skill-blocks', day: OTHER, skillId: 'g1', delta: -2 },
      { type: 'awards', awards: {}, fresh: [] },
    ]);
  });

  it('поверх уже накопленного состояния', () => {
    // Правки ложатся на историю, прочитанную из хранилища: журнал видит её как
    // снимок, а не как свои операции.
    const from = emptyState();
    // Снимок приходит итогами, а не нажатиями: счётчик есть, времён нет. Стек
    // при этом обязателен — счётчик считается его длиной, и без него снятие
    // сняло бы не ту отметку, а сразу все.
    from.journal.clicks = { [DAY]: { ab: 5 } };
    from.journal.marks = timelessMarks(from.journal.clicks);

    const clock = createClock('aaaa1111', emptyHlc());
    const stamp = (): string => clock.stamp();
    const action: Action = { type: 'blocks', day: DAY, priorityId: 'ab', delta: -1 };

    const ops = recordOps(from, action, stamp);
    const state = reduce(from, action);
    const base = emptyBase();
    base.clicks = { [DAY]: { ab: 5 } };

    expect(project(base, ops).journal.clicks).toEqual(state.journal.clicks);
    expect(state.journal.clicks[DAY]).toEqual({ ab: 4 });
  });
});

describe('какие действия попадают в журнал', () => {
  it('меняющие историю — да, остальные — нет', () => {
    expect(isRecordable({ type: 'blocks' })).toBe(true);
    expect(isRecordable({ type: 'drain' })).toBe(true);
    expect(isRecordable({ type: 'awards' })).toBe(true);
    // Настройки и каталоги — не история: они едут документом целиком.
    expect(isRecordable({ type: 'settings' })).toBe(false);
    expect(isRecordable({ type: 'skills' })).toBe(false);
    expect(isRecordable({ type: 'hydrate' })).toBe(false);
    expect(isRecordable({ type: 'dismiss-fresh' })).toBe(false);
  });
});

describe('восстановление копии', () => {
  const contents = {
    settings: emptySettings(),
    journal: {
      clicks: { [DAY]: { ab: 3 } },
      // Копия возвращает итоги, а не отдельные нажатия: времена через файл не
      // ездят, и восстановленные отметки честно не знают, когда их поставили.
      marks: { [DAY]: { ab: [null, null, null] as MarkTime[] } },
      battery: { [DAY]: [[540, 2] as [number, 2], [900, 1, 'ab'] as [number, 1, string]] },
    },
    skills: emptySkills(),
    skillClicks: { [DAY]: { g1: 2 } },
    awards: { s1: DAY },
  };

  it('даёт ровно то состояние, что было в копии', () => {
    const clock = createClock('aaaa1111', emptyHlc());
    const projected = project(
      emptyBase(),
      opsForContents(contents, () => clock.stamp()),
    );
    expect(projected.journal).toEqual(contents.journal);
    expect(projected.skillClicks).toEqual(contents.skillClicks);
    expect(projected.awards).toEqual(contents.awards);
  });

  it('повторный прогон ничего не удваивает', () => {
    // Ради этого копия пишется установкой итога, а не слагаемыми.
    const clock = createClock('aaaa1111', emptyHlc());
    const stamp = (): string => clock.stamp();
    const twice = [...opsForContents(contents, stamp), ...opsForContents(contents, stamp)];
    expect(project(emptyBase(), twice).journal.clicks).toEqual(contents.journal.clicks);
  });

  it('стирает то, чего в копии нет', () => {
    const clock = createClock('aaaa1111', emptyHlc());
    const base = emptyBase();
    base.clicks = { '2020-01-01': { zz: 99 } };
    base.battery = { '2020-01-01': [[10, 1]] };

    const projected = project(
      base,
      opsForContents(contents, () => clock.stamp()),
    );
    expect(projected.journal.clicks['2020-01-01']).toBeUndefined();
    expect(projected.journal.battery['2020-01-01']).toBeUndefined();
  });
});
