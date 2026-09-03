/**
 * Обмен операциями.
 *
 * Три действия и ничего больше: отдать своё, забрать чужое, начать с нуля.
 * Никакого слияния на сервере нет и не будет — он хранилище и курсор, а
 * складывает операции в состояние клиент, той же чистой функцией, которой
 * пользуется локально. Иначе пришлось бы держать две реализации правил
 * слияния и следить, чтобы они не разошлись.
 *
 * `user_id` берётся только из проверенного токена. В D1 нет row-level security,
 * которая подстраховала бы от ошибки, поэтому в каждом запросе он подставляется
 * явно и никогда не читается из тела.
 */

import type { Env } from './env';
import { badRequest } from './http';
import { sanitizeOp, type StoredOp } from './ops';
import type { Caller } from './session';

/**
 * Сколько операций принимаем за раз. Ограничение не от жадности: пачка идёт
 * одной транзакцией, а суточная квота D1 на записанные строки общая на аккаунт.
 */
const MAX_PUSH = 500;
/** Сколько отдаём за раз. Клиент дочитает следующим запросом по курсору. */
const PULL_LIMIT = 1000;

const DOC_KINDS = new Set(['settings', 'skills']);
const MAX_DOC_BYTES = 64 * 1024;

export interface SyncDoc {
  kind: string;
  body: string;
  hlc: string;
}

export interface PullResult {
  ops: unknown[];
  docs: SyncDoc[];
  seq: number;
  /** Отдали не всё: за курсором есть ещё. */
  more: boolean;
}

async function currentSeq(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare('select max(server_seq) as seq from ops where user_id = ?')
    .bind(userId)
    .first<{ seq: number | null }>();
  return Number(row?.seq ?? 0);
}

function sanitizeDoc(raw: unknown): SyncDoc | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  if (typeof value.kind !== 'string' || !DOC_KINDS.has(value.kind)) return undefined;
  if (typeof value.body !== 'string' || value.body.length === 0) return undefined;
  if (typeof value.hlc !== 'string' || !value.hlc) return undefined;
  if (new TextEncoder().encode(value.body).length > MAX_DOC_BYTES) return undefined;
  return { kind: value.kind, body: value.body, hlc: value.hlc };
}

export async function handlePush(
  env: Env,
  caller: Caller,
  body: unknown,
): Promise<{ seq: number; accepted: number; rejected: number }> {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const rawOps = Array.isArray(input.ops) ? input.ops : [];
  const rawDocs = Array.isArray(input.docs) ? input.docs : [];

  if (rawOps.length > MAX_PUSH) throw badRequest('too-many-ops');

  const ops: StoredOp[] = [];
  for (const raw of rawOps) {
    const op = sanitizeOp(raw);
    if (op) ops.push(op);
  }
  const rejected = rawOps.length - ops.length;

  const statements = [];

  for (const op of ops) {
    /*
     * `insert or ignore` по уникальному (user_id, op_id).
     *
     * Доставка «хотя бы один раз» — норма: клиент повторяет пачку после обрыва,
     * не зная, дошла ли она. Падать на повторе значило бы, что одна уже
     * доставленная операция роняет всю пачку целиком.
     */
    statements.push(
      env.DB.prepare(
        `insert or ignore into ops
           (user_id, op_id, kind, hlc, device_id, day, target_id, minute, amount, level)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        caller.userId,
        op.opId,
        op.kind,
        op.hlc,
        caller.deviceId,
        op.day,
        op.targetId,
        op.minute,
        op.amount,
        op.level,
      ),
    );
  }

  /*
   * Отметка о первой записи — единственное, что свёртка стирает безвозвратно
   * (см. `migrations/0004_first_op.sql`). Идёт той же пачкой, что и вставка:
   * либо операции записались вместе с отметкой, либо ни того, ни другого.
   *
   * `first_op_at is null` — весь замок. Второй push по этому условию просто не
   * находит строки, так что «поставить один раз» здесь не проверка, а форма
   * запроса: обогнать саму себя он не может даже при гонке.
   *
   * Значение берётся из журнала, а не из `datetime('now')`, — тем же запросом,
   * что и разовый догон в миграции. Между применением миграции и выкатом кода
   * проходит время, и профиль, приславший операции в этом промежутке, получил
   * бы отметку на дни позже своей настоящей первой записи.
   */
  if (ops.length > 0) {
    statements.push(
      env.DB.prepare(
        `update profiles
            set first_op_at = (select min(created_at) from ops where ops.user_id = profiles.user_id)
          where profiles.user_id = ? and profiles.first_op_at is null`,
      ).bind(caller.userId),
    );
  }

  for (const raw of rawDocs) {
    const doc = sanitizeDoc(raw);
    if (!doc) continue;
    /*
     * Документ целиком заменяется, но только если пришедшая метка новее.
     * Условие в `where` — не украшение: без него запись со второго устройства
     * откатывала бы более свежую правку просто потому, что пришла позже.
     */
    statements.push(
      env.DB.prepare(
        `insert into documents (user_id, kind, body, hlc, device_id)
         values (?, ?, ?, ?, ?)
         on conflict (user_id, kind) do update set
           body = excluded.body,
           hlc = excluded.hlc,
           device_id = excluded.device_id,
           updated_at = datetime('now')
         where excluded.hlc > documents.hlc`,
      ).bind(caller.userId, doc.kind, doc.body, doc.hlc, caller.deviceId),
    );
  }

  if (statements.length > 0) await env.DB.batch(statements);

  return { seq: await currentSeq(env, caller.userId), accepted: ops.length, rejected };
}

export async function handlePull(
  env: Env,
  caller: Caller,
  since: number,
): Promise<PullResult> {
  const from = Number.isFinite(since) && since > 0 ? Math.trunc(since) : 0;

  const rows = await env.DB.prepare(
    `select server_seq, op_id, kind, hlc, device_id, day, target_id, minute, amount, level
       from ops
      where user_id = ? and server_seq > ?
      order by server_seq
      limit ?`,
  )
    .bind(caller.userId, from, PULL_LIMIT + 1)
    .all<Record<string, unknown>>();

  const all = rows.results ?? [];
  const more = all.length > PULL_LIMIT;
  const page = more ? all.slice(0, PULL_LIMIT) : all;

  const docs = await env.DB.prepare('select kind, body, hlc from documents where user_id = ?')
    .bind(caller.userId)
    .all<SyncDoc>();

  const seq = page.length > 0 ? Number(page[page.length - 1]!.server_seq) : from;

  /*
   * Отметка о том, докуда дочитало устройство. На ней держится свёртка: убрать
   * операции можно только до места, которое забрали все живые устройства.
   * Двигается только вперёд — параллельные запросы иначе откатывали бы её.
   */
  await env.DB.prepare(
    `update devices
        set last_seen_seq = max(last_seen_seq, ?), last_seen_at = datetime('now')
      where user_id = ? and device_id = ?`,
  )
    .bind(seq, caller.userId, caller.deviceId)
    .run();

  return {
    ops: page.map((row) => ({
      opId: row.op_id,
      kind: row.kind,
      hlc: row.hlc,
      ...(row.day === null ? {} : { day: row.day }),
      ...(row.target_id === null ? {} : { targetId: row.target_id }),
      ...(row.minute === null ? {} : { minute: row.minute }),
      ...(row.amount === null ? {} : { amount: row.amount }),
      ...(row.level === null ? {} : { level: row.level }),
    })),
    docs: docs.results ?? [],
    seq,
    more,
  };
}

/**
 * Всё состояние сразу: свёрнутый архив плюс хвост журнала.
 *
 * Отдельно от `pull`, потому что новое устройство и устройство после свёртки
 * должны получить снимки, а не десять тысяч операций. Пока свёртки нет, ответ
 * совпадает с чтением журнала с нуля — но клиент уже сейчас должен уметь
 * читать эту форму, иначе включение свёртки станет ломающим изменением.
 */
export async function handleBootstrap(
  env: Env,
  caller: Caller,
): Promise<PullResult & { snapshots: Array<Record<string, unknown>> }> {
  const snapshots = await env.DB.prepare(
    'select scope, month, body, through_seq from month_snapshots where user_id = ?',
  )
    .bind(caller.userId)
    .all<Record<string, unknown>>();

  const through = (snapshots.results ?? []).reduce(
    (max, row) => Math.max(max, Number(row.through_seq ?? 0)),
    0,
  );

  return { snapshots: snapshots.results ?? [], ...(await handlePull(env, caller, through)) };
}
