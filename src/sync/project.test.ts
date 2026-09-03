import { describe, expect, it } from 'vitest';

import { formatStamp } from './hlc';
import type { Op, OpKind } from './ops';
import { emptyBase, project, type Base } from './project';

let counter = 0;

/** Операция с заданной меткой: в тестах порядок задаётся числом, а не часами. */
function op(kind: OpKind, at: number, rest: Partial<Op> = {}): Op {
  counter += 1;
  return {
    opId: `op-${counter}`,
    kind,
    hlc: formatStamp({ wall: at, counter: 0 }, 'aaaa1111'),
    ...rest,
  };
}

const DAY = '2026-08-06';

function blocks(ops: Op[], base: Base = emptyBase()): Record<string, number> {
  return project(base, ops).journal.clicks[DAY] ?? {};
}

describe('счётчики блоков', () => {
  it('слагаемые складываются', () => {
    expect(
      blocks([
        op('blk', 1, { day: DAY, targetId: 'ab', amount: 1 }),
        op('blk', 2, { day: DAY, targetId: 'ab', amount: 1 }),
        op('blk', 3, { day: DAY, targetId: 'ab', amount: 1 }),
      ]),
    ).toEqual({ ab: 3 });
  });

  it('снятый блок не воскресает', () => {
    /*
     * Тот самый случай, ради которого всё затевалось. В прежней модели месяц
     * хранился как итог, а два итога сливались через Math.max: телефон помнил
     * 2, компьютер 3, побеждало 3, и снятие откатывалось само собой.
     */
    expect(
      blocks([
        op('blk', 1, { day: DAY, targetId: 'ab', amount: 3 }),
        op('blk', 2, { day: DAY, targetId: 'ab', amount: -1 }),
      ]),
    ).toEqual({ ab: 2 });
  });

  it('одновременные нажатия на двух устройствах складываются', () => {
    // Побеждающая запись дала бы здесь 5: оба устройства видели 4 и записали 5.
    expect(
      blocks([
        op('blk', 1, { day: DAY, targetId: 'ab', amount: 4 }),
        op('blk', 2, { day: DAY, targetId: 'ab', amount: 1 }),
        op('blk', 2, { day: DAY, targetId: 'ab', amount: 1 }),
      ]),
    ).toEqual({ ab: 6 });
  });

  it('порядок доставки не важен', () => {
    const ops = [
      op('blk', 1, { day: DAY, targetId: 'ab', amount: 2 }),
      op('blk', 2, { day: DAY, targetId: 'cd', amount: 5 }),
      op('blk', 3, { day: DAY, targetId: 'ab', amount: -1 }),
      op('bat', 4, { day: DAY, minute: 540, level: 3 }),
      op('bat', 5, { day: DAY, minute: 540, level: 2 }),
    ];
    const straight = project(emptyBase(), ops);
    const reversed = project(emptyBase(), [...ops].reverse());
    const shuffled = project(emptyBase(), [ops[3]!, ops[0]!, ops[4]!, ops[2]!, ops[1]!]);

    expect(reversed).toEqual(straight);
    expect(shuffled).toEqual(straight);
  });

  it('повторная доставка ничего не меняет', () => {
    const once = op('blk', 1, { day: DAY, targetId: 'ab', amount: 1 });
    expect(blocks([once, { ...once }, { ...once }])).toEqual({ ab: 1 });
  });

  it('счётчик не уходит ниже нуля', () => {
    // Рассинхрон может принести больше снятий, чем добавлений: минус два блока
    // не значит ничего, и в проекции такой ячейки просто нет.
    expect(
      blocks([
        op('blk', 1, { day: DAY, targetId: 'ab', amount: 1 }),
        op('blk', 2, { day: DAY, targetId: 'ab', amount: -3 }),
      ]),
    ).toEqual({});
  });

  it('слагаемые ложатся поверх снимка', () => {
    const base = emptyBase();
    base.clicks = { [DAY]: { ab: 4 } };
    expect(blocks([op('blk', 1, { day: DAY, targetId: 'ab', amount: -1 })], base)).toEqual({ ab: 3 });
  });

  it('навыки считаются по тем же правилам, но отдельно', () => {
    const projected = project(emptyBase(), [
      op('blk', 1, { day: DAY, targetId: 'ab', amount: 2 }),
      op('sblk', 2, { day: DAY, targetId: 'kx', amount: 3 }),
    ]);
    expect(projected.journal.clicks[DAY]).toEqual({ ab: 2 });
    expect(projected.skillClicks[DAY]).toEqual({ kx: 3 });
  });
});

describe('установка итога', () => {
  it('задаёт значение заново, а не прибавляет', () => {
    expect(
      blocks([
        op('blk', 1, { day: DAY, targetId: 'ab', amount: 5 }),
        op('blkset', 2, { day: DAY, targetId: 'ab', amount: 2 }),
      ]),
    ).toEqual({ ab: 2 });
  });

  it('повторный импорт не удваивает историю', () => {
    // Ровно ради этого импорт старых данных пишет blkset, а не blk: прогнать
    // миграцию дважды должно быть безопасно.
    const first = op('blkset', 1, { day: DAY, targetId: 'ab', amount: 7 });
    const second = op('blkset', 2, { day: DAY, targetId: 'ab', amount: 7 });
    expect(blocks([first, second])).toEqual({ ab: 7 });
  });

  it('слагаемые новее установки прибавляются, старее — нет', () => {
    expect(
      blocks([
        op('blk', 1, { day: DAY, targetId: 'ab', amount: 99 }),
        op('blkset', 2, { day: DAY, targetId: 'ab', amount: 3 }),
        op('blk', 3, { day: DAY, targetId: 'ab', amount: 1 }),
      ]),
    ).toEqual({ ab: 4 });
  });
});

describe('стек отметок', () => {
  const marks = (ops: Op[], base: Base = emptyBase()): Record<string, (number | null)[]> =>
    project(base, ops).journal.marks[DAY] ?? {};

  it('нажатие несёт время, дописанный прошлый день — нет', () => {
    // Время означает «когда отметили». У записи в прошедший день его нет, и
    // выдумывать его нечем — в стеке остаётся пустое место.
    expect(
      marks([
        op('blk', 1, { day: DAY, targetId: 'ab', amount: 1, minute: 725 }),
        op('blk', 2, { day: DAY, targetId: 'ab', amount: 1 }),
        op('blk', 3, { day: DAY, targetId: 'ab', amount: 1, minute: 850 }),
      ]),
    ).toEqual({ ab: [725, null, 850] });
  });

  it('«+ + −» оставляет две ранние отметки, а не любые две', () => {
    /*
     * То, ради чего стек и заводился. Пока блоки одинаковы, разницы не видно;
     * как только у них появилось время, снятие обязано убирать именно ту
     * отметку, которую только что поставили.
     */
    expect(
      marks([
        op('blk', 1, { day: DAY, targetId: 'ab', amount: 1, minute: 725 }),
        op('blk', 2, { day: DAY, targetId: 'ab', amount: 1, minute: 820 }),
        op('blk', 3, { day: DAY, targetId: 'ab', amount: 1, minute: 910 }),
        op('blk', 4, { day: DAY, targetId: 'ab', amount: -1 }),
      ]),
    ).toEqual({ ab: [725, 820] });
  });

  it('слагаемое больше единицы кладёт столько же отметок с одним временем', () => {
    expect(
      marks([op('blk', 1, { day: DAY, targetId: 'ab', amount: 3, minute: 600 })]),
    ).toEqual({ ab: [600, 600, 600] });
  });

  it('порядок доставки не меняет стек', () => {
    const ops = [
      op('blk', 1, { day: DAY, targetId: 'ab', amount: 1, minute: 725 }),
      op('blk', 2, { day: DAY, targetId: 'ab', amount: 1, minute: 820 }),
      op('blk', 3, { day: DAY, targetId: 'ab', amount: -1 }),
      op('blk', 4, { day: DAY, targetId: 'ab', amount: 1, minute: 910 }),
    ];
    const straight = marks(ops);

    expect(straight).toEqual({ ab: [725, 910] });
    expect(marks([...ops].reverse())).toEqual(straight);
    expect(marks([ops[2]!, ops[0]!, ops[3]!, ops[1]!])).toEqual(straight);
  });

  it('повторная доставка ничего не меняет', () => {
    const once = op('blk', 1, { day: DAY, targetId: 'ab', amount: 1, minute: 725 });
    expect(marks([once, { ...once }, { ...once }])).toEqual({ ab: [725] });
  });

  it('установка итога сбрасывает стек в отметки без времени', () => {
    // Восстановление копии и импорт возвращают итог, а не отдельные нажатия:
    // времён у этих блоков нет и взяться им неоткуда.
    expect(
      marks([
        op('blk', 1, { day: DAY, targetId: 'ab', amount: 1, minute: 725 }),
        op('blkset', 2, { day: DAY, targetId: 'ab', amount: 2 }),
      ]),
    ).toEqual({ ab: [null, null] });
  });

  it('снимок месяца даёт отметки без времени', () => {
    // Свёртка на сервере складывает старые операции в месячные итоги, и времена
    // там исчезают. Счётчик обязан пережить это без потерь.
    const base = emptyBase();
    base.clicks = { [DAY]: { ab: 2 } };
    expect(marks([op('blk', 1, { day: DAY, targetId: 'ab', amount: 1, minute: 725 })], base)).toEqual(
      { ab: [null, null, 725] },
    );
  });

  it('барьер стирания обнуляет и стек', () => {
    expect(
      marks([
        op('blk', 1, { day: DAY, targetId: 'ab', amount: 2, minute: 725 }),
        op('clear', 2),
        op('blk', 3, { day: DAY, targetId: 'ab', amount: 1, minute: 910 }),
      ]),
    ).toEqual({ ab: [910] });
  });

  it('счётчик — это длина стека, всегда', () => {
    /*
     * Инвариант, на котором держится снятие: разойдись счётчик со стеком, «−»
     * убирало бы не ту отметку. Считать их порознь нечем — счётчик и есть длина.
     */
    const projected = project(
      emptyBase(),
      [
        op('blk', 1, { day: DAY, targetId: 'ab', amount: 4, minute: 600 }),
        op('blk', 2, { day: DAY, targetId: 'cd', amount: 2 }),
        op('blk', 3, { day: DAY, targetId: 'ab', amount: -3 }),
        op('blkset', 4, { day: DAY, targetId: 'ef', amount: 5 }),
        op('blk', 5, { day: DAY, targetId: 'ef', amount: 1, minute: 900 }),
      ],
    );

    for (const [day, entry] of Object.entries(projected.journal.clicks)) {
      for (const [id, count] of Object.entries(entry)) {
        expect(projected.journal.marks[day]?.[id]).toHaveLength(count);
      }
    }
    expect(projected.journal.clicks[DAY]).toEqual({ ab: 1, cd: 2, ef: 6 });
  });

  it('снятий больше, чем добавлений: пустой стек, а не яма', () => {
    /*
     * Два устройства видели три блока и оба сняли все три. Прежний счётчик
     * уходил при этом в −3, и следующее «+» на экране не появлялось — оно
     * уходило в яму. Стеку ямы взять негде.
     */
    expect(
      marks([
        op('blk', 1, { day: DAY, targetId: 'ab', amount: 3, minute: 600 }),
        op('blk', 2, { day: DAY, targetId: 'ab', amount: -3 }),
        op('blk', 3, { day: DAY, targetId: 'ab', amount: -3 }),
        op('blk', 4, { day: DAY, targetId: 'ab', amount: 1, minute: 910 }),
      ]),
    ).toEqual({ ab: [910] });
  });

  it('навыкам стек не считается отдельно — у них его и не спрашивают', () => {
    const projected = project(emptyBase(), [
      op('sblk', 1, { day: DAY, targetId: 'kx', amount: 3 }),
    ]);
    expect(projected.skillClicks[DAY]).toEqual({ kx: 3 });
    expect(projected.journal.marks[DAY]).toBeUndefined();
  });
});

describe('переходы заряда', () => {
  const battery = (ops: Op[], base: Base = emptyBase()) =>
    project(base, ops).journal.battery[DAY] ?? [];

  it('уровень на минуте — побеждает большая метка', () => {
    expect(
      battery([
        op('bat', 2, { day: DAY, minute: 540, level: 3 }),
        op('bat', 1, { day: DAY, minute: 540, level: 1 }),
      ]),
    ).toEqual([[540, 3]]);
  });

  it('ответ о расходе живёт отдельно от уровня', () => {
    // Прежнее правило «побеждает запись с ответом» не давало ни изменить ответ,
    // ни убрать его: он был частью той же ячейки, что и уровень.
    expect(
      battery([
        op('bat', 1, { day: DAY, minute: 540, level: 1 }),
        op('drain', 2, { day: DAY, minute: 540, targetId: 'ab' }),
        op('drain', 3, { day: DAY, minute: 540, targetId: '!дорога' }),
      ]),
    ).toEqual([[540, 1, '!дорога']]);
  });

  it('переход снимается', () => {
    expect(
      battery([
        op('bat', 1, { day: DAY, minute: 540, level: 2 }),
        op('batdel', 2, { day: DAY, minute: 540 }),
      ]),
    ).toEqual([]);
  });

  it('переход, поставленный заново после снятия, остаётся', () => {
    expect(
      battery([
        op('bat', 1, { day: DAY, minute: 540, level: 2 }),
        op('batdel', 2, { day: DAY, minute: 540 }),
        op('bat', 3, { day: DAY, minute: 540, level: 4 }),
      ]),
    ).toEqual([[540, 4]]);
  });

  it('снятие убирает и ответ о расходе', () => {
    expect(
      battery([
        op('bat', 1, { day: DAY, minute: 540, level: 1 }),
        op('drain', 2, { day: DAY, minute: 540, targetId: 'ab' }),
        op('batdel', 3, { day: DAY, minute: 540 }),
        op('bat', 4, { day: DAY, minute: 540, level: 1 }),
      ]),
    ).toEqual([[540, 1]]);
  });

  it('переходы отдаются по возрастанию минуты', () => {
    expect(
      battery([
        op('bat', 1, { day: DAY, minute: 900, level: 1 }),
        op('bat', 2, { day: DAY, minute: 60, level: 4 }),
        op('bat', 3, { day: DAY, minute: 540, level: 2 }),
      ]).map((shift) => shift[0]),
    ).toEqual([60, 540, 900]);
  });

  it('снимок можно поправить операцией', () => {
    const base = emptyBase();
    base.battery = { [DAY]: [[540, 3]] };
    expect(battery([op('batdel', 1, { day: DAY, minute: 540 })], base)).toEqual([]);
  });
});

describe('достижения', () => {
  const awards = (ops: Op[], base: Base = emptyBase()) => project(base, ops).awards;

  it('выдача и снятие идут по метке', () => {
    expect(awards([op('award', 1, { targetId: 's1', day: DAY })])).toEqual({ s1: DAY });
    expect(
      awards([
        op('award', 1, { targetId: 's1', day: DAY }),
        op('unaward', 2, { targetId: 's1' }),
      ]),
    ).toEqual({});
  });

  it('старая выдача не отменяет свежее снятие', () => {
    // Прежнее «берём более раннюю дату» вернуло бы снятую на телефоне отметку
    // при первом же запуске на компьютере.
    expect(
      awards([
        op('unaward', 2, { targetId: 's1' }),
        op('award', 1, { targetId: 's1', day: DAY }),
      ]),
    ).toEqual({});
  });

  it('снятое из снимка убирается', () => {
    const base = emptyBase();
    base.awards = { s1: DAY, s2: DAY };
    expect(awards([op('unaward', 1, { targetId: 's1' })], base)).toEqual({ s2: DAY });
  });
});

describe('барьер стирания', () => {
  it('история до барьера не считается', () => {
    expect(
      blocks([
        op('blk', 1, { day: DAY, targetId: 'ab', amount: 5 }),
        op('clear', 2),
        op('blk', 3, { day: DAY, targetId: 'ab', amount: 1 }),
      ]),
    ).toEqual({ ab: 1 });
  });

  it('барьер отбрасывает и снимки', () => {
    /*
     * Снимок всегда старше барьера, который ещё лежит в журнале: свёртка идёт
     * по порядку и не может убрать барьер, оставив то, что было до него.
     */
    const base = emptyBase();
    base.clicks = { [DAY]: { ab: 40 } };
    base.battery = { [DAY]: [[540, 2]] };

    const projected = project(base, [op('clear', 5)]);
    expect(projected.journal.clicks).toEqual({});
    expect(projected.journal.battery).toEqual({});
  });

  it('достижения барьер не трогает', () => {
    // «Стереть историю» и «начать кабинет заново» — разные операции, ровно как
    // clearHistory и clearEverything сегодня.
    const base = emptyBase();
    base.awards = { s1: DAY };
    const projected = project(base, [
      op('award', 1, { targetId: 's2', day: DAY }),
      op('clear', 2),
    ]);
    expect(projected.awards).toEqual({ s1: DAY, s2: DAY });
  });

  it('считается последний барьер, а не первый', () => {
    expect(
      blocks([
        op('clear', 1),
        op('blk', 2, { day: DAY, targetId: 'ab', amount: 5 }),
        op('clear', 3),
        op('blk', 4, { day: DAY, targetId: 'ab', amount: 2 }),
      ]),
    ).toEqual({ ab: 2 });
  });
});
