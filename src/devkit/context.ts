/**
 * Сборка тикета: что известно о моменте жалобы.
 *
 * Факты снимаются ДО того, как панель тронет экран, и складываются в `Frozen`.
 * Причина простая: пока человек выделяет область и пишет текст, приложение
 * живёт — таймеры срабатывают, тосты исчезают, вкладка меняется. Тикет обязан
 * описывать момент, когда стало не так, а не момент нажатия «Отправить».
 *
 * Ни одного обращения к window на уровне модуля: браузерные факты приезжают
 * аргументом, и поэтому сборка проверяется в node.
 */

import { ask, takeHostError } from './host';
import { redactRecord } from './redact';
import type { LogEntry, ShotError, ShotInfo, Size, TicketPayload } from './types';

export interface BrowserFacts {
  viewport: Size;
  dpr: number;
  screen: Size;
  ua: string;
  language: string;
  online: boolean;
  now: Date;
}

export interface Frozen {
  app: string;
  build: { id: string; time: string };
  createdAt: string;
  tzOffset: number;
  route: string;
  env: TicketPayload['env'];
  snapshot?: Record<string, unknown>;
  log: LogEntry[];
  target?: { path: string; html: string };
  hostError?: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Местное время со смещением: «когда у человека», а не «когда у сервера».
 * Разница в часовом поясе — половина всех «этого не может быть» в отчётах.
 */
export function localIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/**
 * Идентификатор придумывает клиент: повторная отправка из очереди не должна
 * заводить второй тикет. Показываются первые восемь символов, а ключом
 * остаётся весь — совпадение в показе не имеет права стать совпадением в базе.
 */
export function newTicketId(): string {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === 'function') return source.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`;
}

/** Факты браузера. Отдельно от сборки, чтобы сборку можно было проверить без браузера. */
export function browserFacts(): BrowserFacts {
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    dpr: window.devicePixelRatio || 1,
    screen: { w: window.screen?.width ?? 0, h: window.screen?.height ?? 0 },
    ua: navigator.userAgent,
    language: navigator.language,
    online: navigator.onLine,
    now: new Date(),
  };
}

export function freezeContext(input: {
  facts: BrowserFacts;
  log: LogEntry[];
  target?: { path: string; html: string };
}): Frozen {
  const { facts } = input;

  // Каждый вызов хозяина спрашивается отдельно: приложение могло уже упасть, и
  // упавший snapshot() не должен унести с собой route и всё остальное.
  const app = ask('app', (h) => h.app) ?? 'unknown';
  const build = ask('build', (h) => h.build) ?? { id: 'unknown', time: '' };
  const route = ask('route', (h) => h.route?.()) ?? '—';
  const client = ask('client', (h) => h.client?.()) ?? {};
  const flags = ask('flags', (h) => h.flags?.()) ?? {};
  const snapshot = redactRecord(ask('snapshot', (h) => h.snapshot?.()));

  const frozen: Frozen = {
    app,
    build,
    createdAt: localIso(facts.now),
    tzOffset: -facts.now.getTimezoneOffset(),
    route,
    env: {
      viewport: facts.viewport,
      dpr: facts.dpr,
      screen: facts.screen,
      ua: facts.ua,
      language: facts.language,
      online: facts.online,
      client,
      flags,
    },
    log: input.log,
  };

  if (snapshot) frozen.snapshot = snapshot;
  if (input.target) frozen.target = input.target;

  // Список отказов забирается последним: до этой строки в него могли попасть
  // все вызовы выше.
  const hostError = takeHostError();
  if (hostError) frozen.hostError = hostError;

  return frozen;
}

export function buildTicket(
  frozen: Frozen,
  extra: { id: string; note: string; shot?: ShotInfo; shotError?: ShotError },
): TicketPayload {
  const ticket: TicketPayload = {
    v: 1,
    id: extra.id,
    app: frozen.app,
    note: extra.note,
    build: frozen.build,
    createdAt: frozen.createdAt,
    tzOffset: frozen.tzOffset,
    route: frozen.route,
    env: frozen.env,
    log: frozen.log,
  };

  if (frozen.snapshot) ticket.snapshot = frozen.snapshot;
  if (frozen.target) ticket.target = frozen.target;
  if (frozen.hostError) ticket.hostError = frozen.hostError;
  if (extra.shot) ticket.shot = extra.shot;
  if (extra.shotError) ticket.shotError = extra.shotError;

  return ticket;
}
