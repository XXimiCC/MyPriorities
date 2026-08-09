/**
 * Свёртка журнала.
 *
 * Операция весит около четверти килобайта, активный человек делает их десятки
 * в день — журнал растёт линейно и однажды упрётся в тариф. Свёртка заменяет
 * старые операции их итогом: месячным снимком, из которого клиент строит ту же
 * картину, но за одну строку вместо тысячи.
 *
 * Правила слияния сервер берёт из того же модуля, что и приложение
 * (`src/sync/project.ts`), а не повторяет своими словами. Это единственный
 * способ гарантировать, что свёрнутое совпадёт с несвёрнутым: две реализации
 * одних и тех же правил однажды разойдутся, и разойдутся молча.
 *
 * Два предохранителя, без которых свёртка теряет данные:
 *
 *   1. Барьер по устройствам. Убрать операции можно только до места, которое
 *      забрали все живые устройства, иначе отставшее никогда их не увидит.
 *   2. Возраст. Свежее не сворачивается вовсе — незачем, а риск есть.
 */

import { emptyBase, project, type Base } from '../../src/sync/project';
import type { Op } from '../../src/sync/ops';
import type { Env } from './env';

/** Моложе этого не трогаем: выигрыш ничтожен, а поводов ошибиться много. */
const MIN_AGE_DAYS = 14;

/**
 * Устройство, не появлявшееся дольше этого срока, перестаёт держать барьер.
 * Иначе один заброшенный телефон заморозил бы свёртку навсегда. Когда оно
 * вернётся, `bootstrap` отдаст ему снимки — ничего не потеряется.
 */
const DEVICE_STALE_DAYS = 90;

/** Достижения не сворачиваются: их десятки, и они не привязаны к месяцу. */
const KEEP_KINDS = new Set(['award', 'unaward']);

type Scope = 'clicks' | 'skills' | 'battery';

interface Row {
  server_seq: number;
  op_id: string;
  kind: string;
  hlc: string;
  day: string | null;
  target_id: string | null;
  minute: number | null;
  amount: number | null;
  level: number | null;
}

function toOp(row: Row): Op {
  return {
    opId: row.op_id,
    kind: row.kind as Op['kind'],
    hlc: row.hlc,
    ...(row.day === null ? {} : { day: row.day }),
    ...(row.target_id === null ? {} : { targetId: row.target_id }),
    ...(row.minute === null ? {} : { minute: row.minute }),
    ...(row.amount === null ? {} : { amount: row.amount }),
    ...(row.level === null ? {} : { level: row.level as Op['level'] }),
  };
}

const monthOf = (day: string): string => day.slice(0, 7);

/** Докуда можно сворачивать: не дальше самого отставшего из живых устройств. */
async function barrierFor(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `select min(last_seen_seq) as barrier
       from devices
      where user_id = ?
        and last_seen_at > datetime('now', ?)`,
  )
    .bind(userId, `-${DEVICE_STALE_DAYS} days`)
    .first<{ barrier: number | null }>();
  return Number(row?.barrier ?? 0);
}

async function readSnapshots(env: Env, userId: string): Promise<Base> {
  const rows = await env.DB.prepare(
    'select scope, month, body from month_snapshots where user_id = ?',
  )
    .bind(userId)
    .all<{ scope: Scope; month: string; body: string }>();

  const base = emptyBase();
  for (const row of rows.results ?? []) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.body);
    } catch {
      console.warn(`[compact] снимок ${row.scope} ${row.month} не читается`);
      continue;
    }
    const target =
      row.scope === 'clicks' ? base.clicks : row.scope === 'skills' ? base.skillClicks : undefined;
    if (target) Object.assign(target, parsed);
    else Object.assign(base.battery, parsed);
  }
  return base;
}

export interface CompactResult {
  users: number;
  folded: number;
}

/**
 * Сворачивает один месяц-скоуп за раз, потому что снимок хранится по месяцам:
  * так возвращается только тронутое, а не вся история заново.
 */
function byMonth<T>(source: Record<string, T>): Map<string, Record<string, T>> {
  const out = new Map<string, Record<string, T>>();
  for (const [day, value] of Object.entries(source)) {
    const month = monthOf(day);
    (out.get(month) ?? out.set(month, {}).get(month)!)[day] = value;
  }
  return out;
}

async function compactUser(env: Env, userId: string): Promise<number> {
  const barrier = await barrierFor(env, userId);
  if (barrier <= 0) return 0;

  const rows = await env.DB.prepare(
    `select server_seq, op_id, kind, hlc, day, target_id, minute, amount, level
       from ops
      where user_id = ?
        and server_seq <= ?
        and created_at < datetime('now', ?)
      order by server_seq`,
  )
    .bind(userId, barrier, `-${MIN_AGE_DAYS} days`)
    .all<Row>();

  const foldable = (rows.results ?? []).filter((row) => !KEEP_KINDS.has(row.kind));
  if (foldable.length === 0) return 0;

  // Итог считается поверх прежних снимков: свёртка идёт частями, и вторая
  // порция обязана лечь на первую, а не заменить её.
  const projected = project(await readSnapshots(env, userId), foldable.map(toOp));

  const statements = [];
  const put = (scope: Scope, month: string, body: unknown, through: number): void => {
    statements.push(
      env.DB.prepare(
        `insert into month_snapshots (user_id, scope, month, body, through_seq)
         values (?, ?, ?, ?, ?)
         on conflict (user_id, scope, month) do update set
           body = excluded.body, through_seq = excluded.through_seq, updated_at = datetime('now')`,
      ).bind(userId, scope, month, JSON.stringify(body), through),
    );
  };

  const top = foldable[foldable.length - 1]!.server_seq;
  for (const [month, body] of byMonth(projected.journal.clicks)) put('clicks', month, body, top);
  for (const [month, body] of byMonth(projected.skillClicks)) put('skills', month, body, top);
  for (const [month, body] of byMonth(projected.journal.battery)) put('battery', month, body, top);

  /*
   * Удаление идёт поимённо, а не диапазоном `server_seq <= top`: в этом
   * диапазоне остались достижения, которые мы намеренно не сворачивали.
   */
  for (let from = 0; from < foldable.length; from += 100) {
    const chunk = foldable.slice(from, from + 100);
    statements.push(
      env.DB.prepare(
        `delete from ops where user_id = ? and op_id in (${chunk.map(() => '?').join(',')})`,
      ).bind(userId, ...chunk.map((row) => row.op_id)),
    );
  }

  await env.DB.batch(statements);
  return foldable.length;
}

export async function compactAll(env: Env): Promise<CompactResult> {
  const users = await env.DB.prepare(
    // Только те, у кого есть что сворачивать: пустой проход по всем профилям
    // тратил бы суточную квоту чтений на ровном месте.
    `select distinct user_id from ops where created_at < datetime('now', ?)`,
  )
    .bind(`-${MIN_AGE_DAYS} days`)
    .all<{ user_id: string }>();

  let folded = 0;
  let touched = 0;
  for (const { user_id: userId } of users.results ?? []) {
    try {
      const count = await compactUser(env, userId);
      if (count > 0) {
        folded += count;
        touched += 1;
      }
    } catch (error) {
      // Отказ на одном человеке не должен останавливать остальных.
      console.warn('[compact] не свернулось', error);
    }
  }
  return { users: touched, folded };
}
