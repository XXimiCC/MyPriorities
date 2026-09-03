/**
 * Момент первой записи: колонка `profiles.first_op_at`.
 *
 * Проверяется на настоящей SQLite (см. `./d1.ts`), потому что здесь всё дело в
 * самом SQL: «ставится один раз» — это `where first_op_at is null`, а «догон» —
 * `min(created_at)`. Заглушка, отвечающая заготовленным, не отличила бы
 * работающее условие от отсутствующего.
 */

import { describe, expect, it } from 'vitest';

import { handlePush } from '../src/sync';
import { envWith, freshDb, migrationSql, type TestDb } from './d1';

const FIRST_OP = '0004_first_op.sql';

const caller = { userId: 'u-1', deviceId: 'dev1' };

/** Операция, которую примет `sanitizeOp`. Номер меняет только идентификаторы. */
const blk = (n: number) => ({
  opId: `1111111${n}-1111-4111-8111-111111111111`,
  kind: 'blk',
  hlc: `00000000000000${n}:00001:dev1`,
  day: '2026-08-20',
  targetId: 'work',
  amount: 30,
});

/** Профиль есть, журнал пуст — состояние сразу после первого входа. */
function withProfile(before?: string): TestDb {
  const db = freshDb(before);
  db.exec(
    `insert into profiles (user_id, telegram_id, created_at)
     values ('u-1', 1, '2026-08-01 09:00:00')`,
  );
  return db;
}

/** Операция кладётся мимо кода — так получается журнал, доставшийся от старой сборки. */
function oldOp(db: TestDb, n: number, createdAt: string): void {
  db.exec(
    `insert into ops (user_id, op_id, kind, hlc, device_id, day, target_id, amount, created_at)
     values ('u-1', '${blk(n).opId}', 'blk', '${blk(n).hlc}', 'dev1', '2026-08-20', 'work', 30,
             '${createdAt}')`,
  );
}

const markOf = (db: TestDb): string | null =>
  db.row<{ first_op_at: string | null }>(
    "select first_op_at from profiles where user_id = 'u-1'",
  )?.first_op_at ?? null;

const push = (db: TestDb, ...ops: unknown[]) => handlePush(envWith(db), caller, { ops });

describe('миграция', () => {
  it('ложится на пустую базу', () => {
    const column = freshDb().row<{ n: number }>(
      "select count(*) as n from pragma_table_info('profiles') where name = 'first_op_at'",
    );
    expect(column?.n).toBe(1);
  });

  it('догоняет профиль, у которого строки в журнале ещё живы', () => {
    // База в том виде, в каком её оставила предыдущая сборка: операции есть,
    // колонки нет.
    const db = withProfile(FIRST_OP);
    oldOp(db, 1, '2026-08-02 07:10:00');
    oldOp(db, 2, '2026-08-09 21:40:00');

    db.exec(migrationSql(FIRST_OP));

    expect(markOf(db)).toBe('2026-08-02 07:10:00');
  });

  it('профиль без единой операции остаётся без отметки', () => {
    // null — это «ещё ни разу», и выдумывать вместо него дату входа нельзя:
    // весь смысл признака в расстоянии между этими двумя моментами.
    const db = withProfile(FIRST_OP);
    db.exec(migrationSql(FIRST_OP));
    expect(markOf(db)).toBeNull();
  });
});

describe('приём операций', () => {
  it('первая операция ставит отметку', async () => {
    const db = withProfile();
    await push(db, blk(1));

    const journal = db.row<{ at: string }>("select min(created_at) as at from ops");
    expect(markOf(db)).toBe(journal?.at);
    expect(markOf(db)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('вторая операция отметку не перетирает', async () => {
    const db = withProfile();
    await push(db, blk(1));

    // Заведомо чужое значение: совпадение по секундам ничего бы не доказало.
    db.exec("update profiles set first_op_at = '2020-01-01 00:00:00'");
    await push(db, blk(2));

    expect(markOf(db)).toBe('2020-01-01 00:00:00');
  });

  it('повторная доставка той же пачки ничего не меняет', async () => {
    const db = withProfile();
    await push(db, blk(1));
    const first = markOf(db);

    await push(db, blk(1));

    expect(markOf(db)).toBe(first);
    expect(db.row<{ n: number }>('select count(*) as n from ops')?.n).toBe(1);
  });

  it('догоняет профиль, пришедший с журналом и без отметки', async () => {
    // Так выглядит тот, кто прислал операции между миграцией и выкатом кода:
    // отметку он должен получить свою, а не сегодняшнюю.
    const db = withProfile();
    oldOp(db, 1, '2026-08-02 07:10:00');
    expect(markOf(db)).toBeNull();

    await push(db, blk(2));

    expect(markOf(db)).toBe('2026-08-02 07:10:00');
  });
});
