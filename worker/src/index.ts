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

import { handleLogout, handleRefresh, handleTelegramLogin } from './auth';
import type { Env } from './env';
import { HttpError, corsHeaders, json, readJson } from './http';
import { runNightlyReport } from './report';

async function route(request: Request, env: Env): Promise<Response> {
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

  throw new HttpError(404, 'not-found');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);

    if (request.method.toUpperCase() === 'OPTIONS') {
      // Предполётный запрос без разрешённого origin получает 403, а не пустой
      // 204: иначе непонятно, забыли ли домен в списке или сломалось что-то ещё.
      return new Response(null, { status: Object.keys(cors).length ? 204 : 403, headers: cors });
    }

    try {
      const response = await route(request, env);
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
    ctx.waitUntil(runNightlyReport(env));
  },
};
