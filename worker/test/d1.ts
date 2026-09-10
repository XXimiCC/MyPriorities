/**
 * Настоящая SQLite для тестов, которым мало заглушки.
 *
 * Остальные тесты Worker подставляют вместо `env.DB` объект, отвечающий
 * заранее заготовленным: там проверяется код вокруг запроса, а не сам запрос.
 * Здесь наоборот — вся суть в SQL. «Отметка ставится один раз» держится на
 * `where first_op_at is null`, а «догон» — на `min(created_at)`; заглушка,
 * которая просто запомнила текст запроса, не докажет ни того, ни другого.
 *
 * D1 — это SQLite, поэтому обёртки хватает: `node:sqlite` входит в сам Node,
 * зависимости не добавляется, и миграции применяются те же самые, из
 * `migrations/`. Поднимать workerd ради двух таблиц было бы дороже во всём.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { Env } from '../src/env';

type Param = string | number | bigint | null | Uint8Array;
type Row = Record<string, unknown>;

/** Ровно та часть `node:sqlite`, которой мы пользуемся. */
interface SqliteStatement {
  get(...params: Param[]): unknown;
  all(...params: Param[]): unknown[];
  run(...params: Param[]): unknown;
}
interface SqliteDb {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
}

/*
 * `require`, а не `import`: Vite 5 старше модуля `node:sqlite` и не считает его
 * встроенным — на статическом импорте сборка теста падает, пытаясь найти пакет
 * `sqlite` в node_modules. Через createRequire модуль запрашивает уже сам Node,
 * которому он и принадлежит.
 *
 * Типы описаны здесь же, а не взяты из @types/node, по той же причине: модуль
 * новый, и его объявления есть не в каждой версии типов.
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDb;
};

/** Значения, которых SQLite не понимает, приводим к null — как это делает D1. */
function toParam(value: unknown): Param {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value as Param;
}

class Statement {
  constructor(
    private readonly db: SqliteDb,
    private readonly sql: string,
    private readonly params: Param[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(this.db, this.sql, values.map(toParam));
  }

  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }

  async run(): Promise<{ success: true }> {
    this.db.prepare(this.sql).run(...this.params);
    return { success: true };
  }
}

export interface TestDb {
  /** То, что подставляется в `env.DB`. */
  readonly d1: Env['DB'];
  /** Выполнить SQL напрямую — подготовка сцены и проверки в обход кода. */
  exec(sql: string): void;
  /** Одна строка напрямую. */
  row<T = Row>(sql: string): T | undefined;
}

const MIGRATIONS = new URL('../migrations/', import.meta.url);

/** Текст миграции. Тот самый файл, который применяет wrangler, а не его копия. */
export function migrationSql(name: string): string {
  return readFileSync(new URL(name, MIGRATIONS), 'utf8');
}

/**
 * База с применёнными миграциями.
 *
 * `before` останавливает применение перед указанным файлом — так получается
 * база, какой она была до миграции, и на ней видно, что миграция ложится не
 * только на пустую, но и на заполненную старым кодом.
 */
export function freshDb(before?: string): TestDb {
  const db: SqliteDb = new DatabaseSync(':memory:');

  const names = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const name of names) {
    if (name === before) break;
    db.exec(migrationSql(name));
  }

  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    batch: async (statements: Statement[]) => {
      // D1 выполняет пачку одной транзакцией и по порядку. Порядок здесь не
      // деталь: отметка о первой записи считает вставленные тем же вызовом
      // строки и обязана идти после них.
      db.exec('begin');
      try {
        for (const statement of statements) await statement.run();
        db.exec('commit');
      } catch (error) {
        db.exec('rollback');
        throw error;
      }
      return statements.map(() => ({ success: true }));
    },
  } as unknown as Env['DB'];

  return {
    d1,
    exec: (sql: string) => db.exec(sql),
    row: <T = Row,>(sql: string) => db.prepare(sql).get() as T | undefined,
  };
}

/** Env, в котором из всего есть только база: обработчикам `sync.ts` больше нечего. */
export function envWith(db: TestDb): Env {
  return { DB: db.d1 } as Env;
}
