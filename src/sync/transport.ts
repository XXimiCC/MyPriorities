/**
 * Единственное место, которое знает про сеть.
 *
 * Тот же приём, что и с `KeyValueStore`: за интерфейсом сегодня Worker на
 * Cloudflare, а завтра может быть что угодно. Именно это и делает нынешний
 * переезд подъёмным — и оно же оставляет дверь открытой, если Cloudflare
 * разонравится. Всё остальное приложение про адрес и заголовки не знает.
 *
 * Приложение обязано работать без сети и без сессии: транспорт — это способ
 * синхронизации, а не условие запуска. Поэтому здесь нет ни одного места, где
 * отказ сети превращался бы во что-то большее, чем «пока не синхронизировано».
 */

import { sanitizeOp, type Op } from './ops';

export interface Session {
  access: string;
  refresh: string;
  userId: string;
  /** Момент, после которого access просрочен. Локальные миллисекунды. */
  expiresAt: number;
}

export interface LoginInput {
  /** `window.Telegram.WebApp.initData` как есть. */
  initData: string;
  deviceId: string;
  platform?: string;
}

/** Документ целиком: настройки и каталог навыков едут так, а не операциями. */
export interface SyncDoc {
  kind: 'settings' | 'skills';
  body: string;
  hlc: string;
}

export interface PullResult {
  ops: Op[];
  docs: SyncDoc[];
  seq: number;
  /** Отдали не всё: за курсором есть ещё, надо повторить. */
  more: boolean;
}

export interface PushResult {
  seq: number;
  accepted: number;
  /** Сервер отбраковал: наши проверки и его разошлись, это повод для шума. */
  rejected: number;
}

export interface SyncTransport {
  /** Настроен ли адрес: без него приложение просто живёт локально. */
  readonly configured: boolean;
  login(input: LoginInput): Promise<Session>;
  refresh(token: string): Promise<Session>;
  logout(token: string): Promise<void>;
  /** Версия развёрнутого Worker. undefined — не ответил или не настроен. */
  version(): Promise<string | undefined>;

  push(access: string, ops: Op[], docs: SyncDoc[]): Promise<PushResult>;
  pull(access: string, since: number): Promise<PullResult>;
  /** Всё состояние сразу: свёртки плюс хвост журнала. Для нового устройства. */
  bootstrap(access: string): Promise<PullResult>;
}

/** Сервер ответил, но отказал. Отличать от обрыва связи важно: реакция разная. */
export class TransportError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
    this.name = 'TransportError';
  }

  /** Сессия недействительна: продлевать нечего, нужен новый вход. */
  get needsLogin(): boolean {
    return this.status === 401;
  }
}

/** Запас, с которым токен считается просроченным: ответ сети не мгновенный. */
const EXPIRY_MARGIN_MS = 60_000;

const REQUEST_TIMEOUT_MS = 10_000;

interface TokenResponse {
  access?: unknown;
  refresh?: unknown;
  userId?: unknown;
  expiresIn?: unknown;
}

function readSession(raw: unknown, now: number): Session {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as TokenResponse;
  if (typeof value.access !== 'string' || !value.access) throw new TransportError(502, 'no-access');
  if (typeof value.refresh !== 'string' || !value.refresh) {
    throw new TransportError(502, 'no-refresh');
  }
  const seconds = Number(value.expiresIn);
  return {
    access: value.access,
    refresh: value.refresh,
    userId: typeof value.userId === 'string' ? value.userId : '',
    expiresAt: now + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0) - EXPIRY_MARGIN_MS,
  };
}

export function sessionExpired(session: Session, now: number = Date.now()): boolean {
  return session.expiresAt <= now;
}

/**
 * Адрес Worker приходит из сборки. Не задан — транспорт объявляет себя
 * ненастроенным, и приложение работает ровно как раньше: локально.
 */
const BASE_URL = (import.meta.env?.VITE_SYNC_URL as string | undefined)?.replace(/\/+$/, '') ?? '';

function readPull(payload: unknown): PullResult {
  const value = (typeof payload === 'object' && payload !== null ? payload : {}) as {
    ops?: unknown;
    docs?: unknown;
    seq?: unknown;
    more?: unknown;
  };

  // Разбираем операции теми же правилами, что и свои: ответ сервера — такой же
  // недоверенный вход, как всё, что пришло по сети.
  const ops: Op[] = [];
  for (const raw of Array.isArray(value.ops) ? value.ops : []) {
    const op = sanitizeOp(raw);
    if (op) ops.push(op);
  }

  const docs: SyncDoc[] = [];
  for (const raw of Array.isArray(value.docs) ? value.docs : []) {
    const doc = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<SyncDoc>;
    if ((doc.kind === 'settings' || doc.kind === 'skills') && typeof doc.body === 'string') {
      docs.push({ kind: doc.kind, body: doc.body, hlc: String(doc.hlc ?? '') });
    }
  }

  const seq = Number(value.seq);
  return { ops, docs, seq: Number.isFinite(seq) ? seq : 0, more: Boolean(value.more) };
}

export function createTransport(baseUrl: string = BASE_URL): SyncTransport {
  const call = async (path: string, body?: unknown, access?: string): Promise<unknown> => {
    if (!baseUrl) throw new TransportError(0, 'not-configured');

    // Предел ожидания свой, а не браузерный: тот бывает в минуты, а держать
    // синхронизацию столько незачем — она повторится при следующем открытии.
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(baseUrl + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(access ? { Authorization: `Bearer ${access}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: abort.signal,
      });
    } catch (error) {
      // Обрыв связи — не отказ сервера. Ноль в статусе означает «не доехало»,
      // и наверху это повод повторить позже, а не разлогинить человека.
      throw new TransportError(0, error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'offline');
    } finally {
      window.clearTimeout(timer);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const code = (payload as { error?: unknown }).error;
      throw new TransportError(response.status, typeof code === 'string' ? code : 'unknown');
    }
    return payload;
  };

  return {
    configured: Boolean(baseUrl),

    async login(input) {
      return readSession(await call('/auth/telegram', input), Date.now());
    },

    async refresh(token) {
      return readSession(await call('/auth/refresh', { refresh: token }), Date.now());
    },

    async logout(token) {
      try {
        await call('/auth/logout', { refresh: token });
      } catch {
        // Выход — вежливость по отношению к серверу, а не условие. Локальную
        // сессию всё равно стираем: не вышло сказать — забыли молча.
      }
    },

    async version() {
      try {
        const payload = await call('/health');
        const value = (payload as { version?: unknown }).version;
        return typeof value === 'string' ? value : undefined;
      } catch {
        // Справочная строка в настройках не повод шуметь.
        return undefined;
      }
    },

    async push(access, ops, docs) {
      const payload = (await call('/sync/push', { ops, docs }, access)) as Partial<PushResult>;
      return {
        seq: Number(payload.seq) || 0,
        accepted: Number(payload.accepted) || 0,
        rejected: Number(payload.rejected) || 0,
      };
    },

    async pull(access, since) {
      return readPull(await call(`/sync/pull?since=${Math.max(0, Math.trunc(since))}`, undefined, access));
    },

    async bootstrap(access) {
      return readPull(await call('/sync/bootstrap', undefined, access));
    },
  };
}

export const transport: SyncTransport = createTransport();
