/**
 * Тикеты из встроенной панели отладки.
 *
 * Две двери в одну комнату, и они разные не по недосмотру:
 *
 *   приложение приходит с обычным Bearer-токеном сессии. Общий ключ ему выдать
 *     нельзя — он попал бы в бандл и перестал быть ключом в тот же день.
 *   командная строка приходит с DEVKIT_TOKEN в своём заголовке. initData у неё
 *     нет и быть не может: подпись выдаёт клиент Telegram, а не терминал.
 *
 * Поэтому проверка выбирается по маршруту, а не ставится одной строкой сверху,
 * как у /sync/.
 *
 * Кадр лежит в KV, а не в D1: срок хранения там встроен (expirationTtl), и
 * отдельной уборки картинок не нужно вовсе. Обмен изолирован в putShot/getShot
 * — переезд на R2, если он когда-нибудь понадобится, стоит двух функций.
 */

import { timingSafeEqual } from './crypto';
import type { Env } from './env';
import { HttpError, badRequest } from './http';
import { authenticate, type Caller } from './session';

/** Тело целиком: кадр плюс контекст с запасом. Проверяется до чтения. */
const MAX_BODY_BYTES = 1_500_000;
const MAX_SHOT_BYTES = 1_000_000;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_NOTE = 2000;

/** Сколько открытых тикетов можно накопить. Не от жадности — от зацикленной отправки. */
const MAX_OPEN_PER_USER = 20;

const SHOT_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);

/** Месяц хранения. Тикет старше месяца — это либо починенное, либо забытое. */
const SHOT_TTL_SECONDS = 30 * 24 * 60 * 60;

const EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export interface TicketRow {
  id: string;
  /** Кто прислал. У тикета от тестировщика это не наш номер — и это видно сразу. */
  telegram_id: number | null;
  app: string;
  status: string;
  note: string;
  payload: string;
  build_id: string | null;
  route: string | null;
  shot_key: string | null;
  shot_bytes: number | null;
  shot_mime: string | null;
  created_at: string;
  closed_at: string | null;
  fix_note: string | null;
}

/**
 * Разбор белого списка.
 *
 * Пусто или не задано — не может никто: закрыто по умолчанию, потому что цена
 * ошибки в эту сторону — чужие кадры экрана в нашей базе. Звёздочка
 * подстановкой НЕ является намеренно: «разрешить всем» должно требовать правки
 * кода, а не одного символа в переменной.
 */
export function parseAllowList(raw: string | undefined): Set<number> {
  const allowed = new Set<number>();
  for (const part of (raw ?? '').split(',')) {
    const id = Number(part.trim());
    if (Number.isSafeInteger(id) && id > 0) allowed.add(id);
  }
  return allowed;
}

/**
 * Пускать ли этого человека.
 *
 * Две двери, и вторая слабее первой намеренно:
 *
 *   белый список — хозяин приложения. Номер Telegram нельзя подделать: он
 *     берётся из профиля, созданного проверенной подписью.
 *   ключ приглашения — тестировщик, которому дали ссылку. Собирать у каждого
 *     помощника номер Telegram — ровно та возня, из-за которой помогать
 *     перестают. Ключ открывает только право завести тикет, и всегда со своего
 *     аккаунта: анонимных тикетов не бывает, отправитель записан в строке.
 */
export function hasInvite(env: Env, invite?: string): boolean {
  return Boolean(invite && env.DEVKIT_INVITE && timingSafeEqual(invite, env.DEVKIT_INVITE));
}

export async function isAllowed(
  env: Env,
  userId?: string,
  invite?: string,
  owner = false,
): Promise<boolean> {
  if (owner || hasInvite(env, invite)) return true;
  if (!userId) return false;

  const allowed = parseAllowList(env.DEVKIT_ALLOW);
  if (allowed.size === 0) return false;

  // Номер берётся из профиля, а не из тела запроса: профиль один и тот же и для
  // мини-аппа, и для входа через браузер (см. handleTelegramLogin).
  const row = await env.DB.prepare('select telegram_id from profiles where user_id = ?')
    .bind(userId)
    .first<{ telegram_id: number }>();

  return row ? allowed.has(Number(row.telegram_id)) : false;
}

/**
 * Кто пришёл, если вход не обязателен.
 *
 * Документация и лендинг — обычные статические сайты: сессии там нет и быть не
 * может. Тикет оттуда приходит без пользователя, и это осознанно: пускает его
 * ключ приглашения, а не личность. Строка в базе остаётся с пустым user_id —
 * колонка nullable ровно для этого случая.
 *
 * Токен, если он всё же есть, всегда сильнее: тикет из приложения обязан быть
 * подписан, даже когда ключ в адресе тоже лежит.
 */
export async function callerOrGuest(request: Request, env: Env): Promise<Caller | undefined> {
  // Токен сессии всегда сильнее: тикет из приложения обязан быть подписан,
  // даже когда рядом лежит ключ из ссылки.
  if (request.headers.get('Authorization')) return authenticate(request, env);

  /*
   * Без входа пускают два ключа:
   *
   *   ключ приглашения — статические сайты, документация и лендинг: сессии там
   *     нет и быть не может;
   *   ключ командной строки — своя машина. Войти через Telegram на localhost
   *     невозможно, бот такого домена не знает, и без этой двери панель на
   *     dev-сервере не могла бы отправить вообще ничего. Это тот же ключ,
   *     которым тикеты забирают и закрывают, — сильнее него у нас нет.
   */
  if (hasInvite(env, inviteOf(request)) || hasDevkitToken(request, env)) return undefined;
  return authenticate(request, env);
}

/** Ключ приглашения из запроса. Заголовок браузерный — он есть в списке CORS. */
export function inviteOf(request: Request): string | undefined {
  return request.headers.get('X-Devkit-Invite') ?? undefined;
}

/**
 * Дверь командной строки. Отдельное имя заголовка намеренно: случайно
 * попавший в браузер токен доступа не может открыть её, а authenticate()
 * остаётся односмысленным.
 */
export function hasDevkitToken(request: Request, env: Env): boolean {
  const expected = env.DEVKIT_TOKEN;
  return Boolean(expected && timingSafeEqual(request.headers.get('X-Devkit-Token') ?? '', expected));
}

export function requireDevkitToken(request: Request, env: Env): void {
  // Не задан — говорим прямо, как и с oidc-not-configured: «не настроено» и
  // «не пустили» должны различаться, иначе настройка превращается в гадание.
  if (!env.DEVKIT_TOKEN) throw new HttpError(503, 'devkit-not-configured');
  if (!hasDevkitToken(request, env)) throw new HttpError(401, 'bad-devkit-token');
}

function shotKey(id: string, mime: string): string {
  const month = new Date().toISOString().slice(0, 7);
  return `shot/${month}/${id}.${EXTENSIONS[mime] ?? 'bin'}`;
}

async function putShot(env: Env, key: string, bytes: ArrayBuffer, mime: string): Promise<void> {
  await env.SHOTS.put(key, bytes, {
    expirationTtl: SHOT_TTL_SECONDS,
    metadata: { mime },
  });
}

async function getShot(env: Env, key: string): Promise<{ bytes: ArrayBuffer; mime: string } | undefined> {
  const found = await env.SHOTS.getWithMetadata<{ mime?: string }>(key, 'arrayBuffer');
  if (!found.value) return undefined;
  return { bytes: found.value, mime: found.metadata?.mime ?? 'application/octet-stream' };
}

interface ParsedTicket {
  id: string;
  app: string;
  note: string;
  buildId: string | null;
  route: string | null;
  payload: string;
}

/** Кадр проверяется до чтения байтов: чужой запрос не должен съедать память. */
export function assertShot(size: number, type: string): void {
  if (size > MAX_SHOT_BYTES) throw badRequest('shot-too-large');
  if (!SHOT_TYPES.has(type)) throw badRequest('bad-shot-type');
}

export function parseTicket(raw: string): ParsedTicket {
  if (raw.length > MAX_PAYLOAD_BYTES) throw badRequest('payload-too-large');

  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw badRequest('not-json');
  }

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const app = typeof value.app === 'string' ? value.app.trim() : '';
  const note = typeof value.note === 'string' ? value.note.slice(0, MAX_NOTE) : '';
  if (!id || id.length > 64) throw badRequest('bad-id');
  if (!app || app.length > 32) throw badRequest('bad-app');

  const build = value.build as { id?: unknown } | undefined;
  return {
    id,
    app,
    note,
    buildId: typeof build?.id === 'string' ? build.id.slice(0, 64) : null,
    route: typeof value.route === 'string' ? value.route.slice(0, 64) : null,
    payload: raw,
  };
}

export interface CreatedTicket {
  id: string;
  status: 'open';
  /** Что уехало в уведомление — зовётся вызывающим через ctx.waitUntil. */
  notify: { caption: string; shot?: { bytes: ArrayBuffer; mime: string } };
}

export async function handleCreateTicket(
  env: Env,
  caller: Caller | undefined,
  request: Request,
): Promise<CreatedTicket> {
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw badRequest('too-large');

  if (!(await isAllowed(env, caller?.userId, inviteOf(request), hasDevkitToken(request, env)))) {
    throw new HttpError(403, 'not-allowed');
  }

  /* Тикеты без входа считаются общей кучей: у них нет владельца, по которому их
     можно было бы развести. Это и есть предел на анонимный поток. */
  const open = caller
    ? await env.DB.prepare("select count(*) as n from tickets where user_id = ? and status = 'open'")
        .bind(caller.userId)
        .first<{ n: number }>()
    : await env.DB.prepare(
        "select count(*) as n from tickets where user_id is null and status = 'open'",
      ).first<{ n: number }>();
  if (Number(open?.n ?? 0) >= MAX_OPEN_PER_USER) throw new HttpError(429, 'too-many');

  const form = await request.formData().catch(() => {
    throw badRequest('not-multipart');
  });

  const raw = form.get('ticket');
  if (typeof raw !== 'string') throw badRequest('no-ticket');
  const ticket = parseTicket(raw);

  let shot: { key: string; bytes: ArrayBuffer; mime: string } | undefined;
  const file = form.get('shot');
  if (file && typeof file !== 'string') {
    assertShot(file.size, file.type);
    shot = { key: shotKey(ticket.id, file.type), bytes: await file.arrayBuffer(), mime: file.type };
    await putShot(env, shot.key, shot.bytes, shot.mime);
  }

  /* insert or ignore, а не insert: идентификатор придумал клиент, и повторная
     отправка из очереди не должна заводить второй тикет. Та же причина, что и
     у операций обмена. */
  await env.DB.prepare(
    `insert or ignore into tickets
       (id, user_id, telegram_id, app, status, note, payload, build_id, route, shot_key, shot_bytes, shot_mime)
     values (?, ?, (select telegram_id from profiles where user_id = ?), ?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      ticket.id,
      caller?.userId ?? null,
      caller?.userId ?? null,
      ticket.app,
      ticket.note,
      ticket.payload,
      ticket.buildId,
      ticket.route,
      shot?.key ?? null,
      shot ? shot.bytes.byteLength : null,
      shot?.mime ?? null,
    )
    .run();

  const who = caller
    ? await env.DB.prepare('select username, telegram_id from profiles where user_id = ?')
        .bind(caller.userId)
        .first<{ username: string | null; telegram_id: number | null }>()
    : null;

  const caption = [
    `#${ticket.id.slice(0, 8)}`,
    // Имя отправителя первым делом: тикетов от тестировщиков будет больше, чем
    // своих, и «кто это прислал» — первый вопрос при разборе.
    who?.username ? `@${who.username}` : (who?.telegram_id ?? 'по ссылке'),
    ticket.app,
    ticket.route ?? '—',
    ticket.buildId ?? '—',
  ].join(' · ');

  return {
    id: ticket.id,
    status: 'open',
    notify: { caption: `${caption}\n${ticket.note}`.slice(0, 1024), ...(shot ? { shot } : {}) },
  };
}

export async function listTickets(env: Env, status: string, limit: number): Promise<TicketRow[]> {
  const rows = await env.DB.prepare(
    `select id, telegram_id, app, status, note, payload, build_id, route, shot_key, shot_bytes, shot_mime,
            created_at, closed_at, fix_note
       from tickets
      where status = ?
      order by created_at asc
      limit ?`,
  )
    .bind(status, Math.min(Math.max(limit, 1), 100))
    .all<TicketRow>();

  return rows.results ?? [];
}

export async function readTicket(env: Env, id: string): Promise<TicketRow> {
  /*
   * Берём две строки, а не одну.
   *
   * Идентификатор принимается началом — так его набирают руками. Совпадение
   * первых символов у двух тикетов маловероятно, но если оно случилось, взять
   * «первый попавшийся» означало бы закрыть чужой тикет и никогда об этом не
   * узнать. Лучше отказать и попросить дописать пару символов.
   */
  const found = await env.DB.prepare(
    `select id, telegram_id, app, status, note, payload, build_id, route, shot_key, shot_bytes, shot_mime,
            created_at, closed_at, fix_note
       from tickets where id = ? or id like ?
      limit 2`,
  )
    .bind(id, `${id}%`)
    .all<TicketRow>();

  const rows = found.results ?? [];
  // Точное совпадение сильнее: полный идентификатор не должен упираться в то,
  // что он же является началом другого.
  const exact = rows.find((row) => row.id === id);
  if (exact) return exact;

  if (rows.length === 0) throw new HttpError(404, 'no-ticket');
  if (rows.length > 1) throw new HttpError(409, 'ambiguous-id');
  return rows[0] as TicketRow;
}

export async function readTicketShot(env: Env, id: string): Promise<Response> {
  const row = await readTicket(env, id);
  if (!row.shot_key) throw new HttpError(404, 'no-shot');

  const shot = await getShot(env, row.shot_key);
  // KV согласован в конечном счёте: сразу после записи значения может ещё не
  // быть. Для командной строки, которая забирает тикеты позже, это неважно.
  if (!shot) throw new HttpError(404, 'no-shot');

  return new Response(shot.bytes, { headers: { 'Content-Type': shot.mime } });
}

export async function closeTicket(
  env: Env,
  id: string,
  body: { note?: unknown; wontfix?: unknown },
): Promise<{ id: string; status: string }> {
  const row = await readTicket(env, id);
  const status = body.wontfix === true ? 'wontfix' : 'closed';
  const note = typeof body.note === 'string' ? body.note.slice(0, MAX_NOTE) : '';

  await env.DB.prepare(
    "update tickets set status = ?, closed_at = datetime('now'), fix_note = ?, closed_by = 'cli' where id = ?",
  )
    .bind(status, note, row.id)
    .run();

  return { id: row.id, status };
}

/** Сколько тикетов ждёт разбора. Строка ночного отчёта. */
export async function countOpenTickets(env: Env): Promise<number> {
  const row = await env.DB.prepare("select count(*) as n from tickets where status = 'open'").first<{
    n: number;
  }>();
  return Number(row?.n ?? 0);
}

/**
 * Уборка. Кадры KV гасит сам по сроку хранения, здесь остаются только строки —
 * иначе таблица растёт вечно, а размер базы и есть то, за чем следит отчёт.
 */
export async function purgeOldTickets(env: Env): Promise<number> {
  const result = await env.DB.prepare(
    "delete from tickets where created_at < datetime('now', '-30 days')",
  ).run();
  return result.meta?.changes ?? 0;
}
