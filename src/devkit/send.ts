/**
 * Отправка тикета и повторные попытки.
 *
 * Одним запросом multipart, а не двумя: один запрос — одна атомарная вещь,
 * которую можно повторить. Разделённые кадр и описание рано или поздно
 * разъедутся, и в базе появится тикет без картинки либо картинка без тикета.
 *
 * Токен доступа спрашивается у приложения в момент отправки и не пишется ни в
 * тикет, ни в очередь: черновик может пролежать на устройстве неделю, а
 * пятнадцатиминутный токен — нет.
 */

import { currentHost } from './host';
import { inviteKey } from './invite';
import { delayDraft, dropDraft, dueDrafts, keepDraft, type Draft } from './outbox';
import type { TicketPayload } from './types';

export type SendOutcome = 'sent' | 'queued' | 'refused';

export interface SendResult {
  outcome: SendOutcome;
  /**
   * Почему не ушло. Показывается человеку дословно.
   *
   * Раньше все отказы выглядели одинаково — «Отчёты сейчас не принимаются», — и
   * «я не вошёл», «меня не пустили» и «нет сети» было не различить. Отладочный
   * инструмент, который сам не умеет объяснить свой отказ, стоит недорого.
   */
  reason?: string;
}

/**
 * Запасной ход только для разработки: вход через Telegram на localhost
 * невозможен — бот такого домена не знает, — а панель нужна прежде всего там.
 *
 * Единственная строка каталога, знающая про Vite. В боевой сборке
 * `import.meta.env.DEV` подставляется как false, ветка вырезается целиком, и
 * вместе с ней исчезает сама ссылка на переменную: токен структурно не может
 * оказаться в бандле.
 */
const DEV_TOKEN: string | undefined = import.meta.env.DEV
  ? (import.meta.env.VITE_DEVKIT_DEV_TOKEN as string | undefined)
  : undefined;

/** Отказ, который не станет лучше от повтора: не пустили. */
class Refused extends Error {}

function base(): string {
  return (currentHost()?.endpoint ?? '').replace(/\/+$/, '');
}

/**
 * Чем доказываем, что это свои. Три двери, и порядок между ними важен.
 *
 * Токен сессии сильнее всего: тикет из приложения обязан быть подписан, даже
 * когда рядом лежит ключ из ссылки.
 *
 * Ключ разработчика — своя машина: войти через Telegram на localhost нельзя.
 *
 * Ключ приглашения — **самостоятельная** дверь, а не добавка к первым двум.
 * Раньше он только дополнял их, и это было тихой поломкой всего пути
 * тестировщика: на документации и лендинге входа нет вовсе, поэтому заголовков
 * не получалось ни одного, и отправка отказывала со словами «нужен вход» при
 * совершенно правильном ключе в адресе. Сервер при этом такие тикеты принимал
 * (см. callerOrGuest) — не доезжали они только из-за этой строчки.
 */
export function pickHeaders(input: {
  token?: string;
  devToken?: string;
  invite?: string;
}): Record<string, string> | undefined {
  const extra: Record<string, string> = {};
  if (input.invite) extra['X-Devkit-Invite'] = input.invite;

  if (input.token) return { Authorization: `Bearer ${input.token}`, ...extra };
  if (input.devToken) return { 'X-Devkit-Token': input.devToken, ...extra };
  if (input.invite) return extra;
  return undefined;
}

async function authHeaders(): Promise<Record<string, string>> {
  const host = currentHost();
  const headers = pickHeaders({
    token: await host?.authToken?.().catch(() => undefined),
    devToken: DEV_TOKEN,
    invite: inviteKey(),
  });
  if (headers) return headers;

  /*
   * Отказ должен называть выход, а не только беду. «Нужен вход» на странице
   * документации — совет, которому нельзя последовать: входа там не бывает.
   */
  throw new Refused(host?.authToken ? 'нужен вход' : 'нужен ключ в адресе: ?test=…');
}

/**
 * Пускают ли меня вообще. Спрашивается один раз при открытии панели, пока
 * снимается кадр, — чтобы человек узнал об отказе до того, как потратит время
 * на разметку и описание, а не после.
 *
 * undefined означает «не знаю»: сети нет, сервер молчит. Пугать в этом случае
 * нечем — отправка всё равно ляжет в очередь.
 */
export async function checkAllowed(): Promise<boolean | undefined> {
  if (!base()) return false;

  let headers: Record<string, string>;
  try {
    headers = await authHeaders();
  } catch {
    // Доказать нечем — значит и спрашивать некому. Отказ человек увидит при
    // отправке, вместе с тем, что с этим делать.
    return false;
  }

  try {
    const response = await fetch(`${base()}/devkit/allowed`, { headers });
    if (response.status === 401 || response.status === 403) return false;
    if (!response.ok) return undefined;
    const body = (await response.json()) as { allowed?: unknown };
    return body.allowed === true;
  } catch {
    return undefined;
  }
}

function extensionFor(mime: string): string {
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/jpeg') return 'jpg';
  return 'png';
}

async function post(ticket: TicketPayload, shot?: Blob): Promise<void> {
  if (!base()) throw new Refused('панель не настроена');

  const headers = await authHeaders();

  const body = new FormData();
  body.append('ticket', JSON.stringify(ticket));
  if (shot) body.append('shot', shot, `shot.${extensionFor(shot.type)}`);

  const response = await fetch(`${base()}/devkit/tickets`, { method: 'POST', headers, body });

  if (response.ok) return;
  // 401 и 403 — это «не для вас», и повторять их бессмысленно. Всё остальное,
  // включая 5xx и обрыв связи, повторяется: сервер мог просто перезапускаться.
  if (response.status === 401) throw new Refused('сервер не узнал ключ');
  if (response.status === 403) throw new Refused('этот аккаунт не в списке');
  if (response.status === 429) throw new Refused('слишком много открытых тикетов');
  throw new Error(`сервер ответил ${response.status}`);
}

/** Отправить прямо сейчас; не вышло по вине связи — оставить в очереди. */
export async function submit(ticket: TicketPayload, shot?: Blob): Promise<SendResult> {
  try {
    await post(ticket, shot);
    return { outcome: 'sent' };
  } catch (error) {
    if (error instanceof Refused) return { outcome: 'refused', reason: error.message };

    const now = Date.now();
    const draft: Draft = {
      id: ticket.id,
      createdAt: now,
      ticket,
      tries: 1,
      nextAt: now + 60_000,
      lastError: error instanceof Error ? error.message : String(error),
    };
    if (shot) draft.shot = shot;

    try {
      await keepDraft(draft);
      return { outcome: 'queued', reason: draft.lastError };
    } catch (kept) {
      console.warn('[devkit] черновик не сохранился', kept);
      return { outcome: 'refused', reason: 'черновик негде сохранить' };
    }
  }
}

let flushing = false;

/** Досылка отложенного. Молча: человек уже забыл про этот тикет. */
export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const now = Date.now();
    for (const draft of await dueDrafts(now)) {
      try {
        await post(draft.ticket, draft.shot);
        await dropDraft(draft.id);
      } catch (error) {
        if (error instanceof Refused) await dropDraft(draft.id);
        else await delayDraft(draft, now, error instanceof Error ? error.message : String(error));
      }
    }
  } catch (error) {
    console.warn('[devkit] очередь не разобралась', error);
  } finally {
    flushing = false;
  }
}
