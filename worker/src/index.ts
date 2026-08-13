/**
 * Точка входа Worker.
 *
 * Маршрутов немного и роутер поэтому свой: сравнение метода и пути читается
 * лучше любой библиотеки, а зависимость в бэкенде стоит ровно столько же, во
 * что она обходится в приложении.
 *
 * Синхронизация (`/sync/*`) появится следующим этапом — сейчас здесь только
 * вход, продление сессии и проверка живости.
 */

import { adminPage } from './admin';
import { handleLogout, handleRefresh, handleTelegramLogin } from './auth';
import {
  callerOrGuest,
  closeTicket,
  handleCreateTicket,
  hasDevkitToken,
  inviteOf,
  isAllowed,
  listTickets,
  readTicket,
  readTicketShot,
  requireDevkitToken,
  updateTicket,
} from './devkit';
import type { Env } from './env';
import { HttpError, corsHeaders, json, readJson } from './http';
import { runNightlyMaintenance } from './report';
import { authenticate } from './session';
import { notifyTicket } from './telegram';
import { handleBootstrap, handlePull, handlePush } from './sync';

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'GET' && (path === '/' || path === '/health')) {
    // Восемь символов версии: сверить с панелью хватает, а целиком она длиннее
    // всей остальной строки в настройках.
    return json({ ok: true, version: env.CF_VERSION?.id.slice(0, 8) ?? null });
  }

  if (method === 'POST' && path === '/auth/telegram') {
    return json(await handleTelegramLogin(env, await readJson(request)));
  }

  if (method === 'POST' && path === '/auth/refresh') {
    return json(await handleRefresh(env, await readJson(request)));
  }

  if (method === 'POST' && path === '/auth/logout') {
    await handleLogout(env, await readJson(request));
    return json({ ok: true });
  }

  // Дальше — только для своих. Проверка стоит один раз здесь, а не в каждом
  // обработчике: забытая в одном месте, она открыла бы чужие данные целиком.
  if (path.startsWith('/sync/')) {
    const caller = await authenticate(request, env);

    if (method === 'POST' && path === '/sync/push') {
      return json(await handlePush(env, caller, await readJson(request)));
    }
    if (method === 'GET' && path === '/sync/pull') {
      return json(await handlePull(env, caller, Number(url.searchParams.get('since') ?? 0)));
    }
    if (method === 'GET' && path === '/sync/bootstrap') {
      return json(await handleBootstrap(env, caller));
    }
  }

  /*
   * Две двери в одну комнату, и проверка поэтому не выносится наверх одной
   * строкой, как у /sync/. У мини-аппа нет и не может быть DEVKIT_TOKEN: он
   * попал бы в бандл и перестал быть ключом. У командной строки нет и не может
   * быть initData: подпись выдаёт клиент Telegram, а не терминал.
   */
  if (path.startsWith('/devkit')) {
    if (method === 'POST' && path === '/devkit/tickets') {
      const created = await handleCreateTicket(env, await callerOrGuest(request, env), request);
      // Уведомление не висит на критическом пути: человек уже нажал «Отправить».
      ctx.waitUntil(notifyTicket(env, created.notify));
      return json({ id: created.id, status: created.status }, { status: 201 });
    }

    if (method === 'GET' && path === '/devkit/allowed') {
      const caller = await callerOrGuest(request, env);
      return json({
        allowed: await isAllowed(env, caller?.userId, inviteOf(request), hasDevkitToken(request, env)),
      });
    }

    /* Разметка админки отдаётся без ключа: сама по себе она пустая, а данные
       без ключа не отдаются ни на одном маршруте ниже. */
    if (method === 'GET' && path === '/devkit/admin') return adminPage();

    // Дальше — только командная строка и админка, у них один ключ.
    requireDevkitToken(request, env);

    if (method === 'GET' && path === '/devkit/tickets') {
      const status = url.searchParams.get('status') ?? 'open';
      const limit = Number(url.searchParams.get('limit') ?? 20);
      return json({ tickets: await listTickets(env, status, Number.isFinite(limit) ? limit : 20) });
    }

    const one = /^\/devkit\/tickets\/([\w-]{4,64})(\/shot|\/close)?$/.exec(path);
    if (one) {
      const id = one[1] as string;
      if (method === 'GET' && one[2] === '/shot') return readTicketShot(env, id);
      if (method === 'POST' && one[2] === '/close') {
        return json(await closeTicket(env, id, (await readJson(request)) as Record<string, unknown>));
      }
      if (method === 'GET' && !one[2]) return json(await readTicket(env, id));
      if (method === 'PATCH' && !one[2]) {
        return json(await updateTicket(env, id, (await readJson(request)) as Record<string, unknown>));
      }
    }
  }

  throw new HttpError(404, 'not-found');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cors = corsHeaders(request, env);

    if (request.method.toUpperCase() === 'OPTIONS') {
      // Предполётный запрос без разрешённого origin получает 403, а не пустой
      // 204: иначе непонятно, забыли ли домен в списке или сломалось что-то ещё.
      return new Response(null, { status: Object.keys(cors).length ? 204 : 403, headers: cors });
    }

    try {
      const response = await route(request, env, ctx);
      for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
      return response;
    } catch (error) {
      if (error instanceof HttpError) {
        // Подробность остаётся в журнале Worker, наружу уходит только код.
        if (error.detail) console.warn(`[${error.code}] ${error.detail}`);
        return json({ error: error.code }, { status: error.status }, cors);
      }
      console.error('[worker] необработанная ошибка', error);
      return json({ error: 'internal' }, { status: 500 }, cors);
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runNightlyMaintenance(env));
  },
};
