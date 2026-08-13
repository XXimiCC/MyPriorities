/**
 * Страница разбора тикетов.
 *
 * Отдаётся самим Worker одной строкой, без сборщика и без файлов рядом. Причина
 * та же, по которой панель отладки попадает на документацию готовым файлом:
 * заводить ради одной страницы третий проект Vercel — дороже, чем она стоит.
 * Здесь же она получается совсем дешёвой: данные у неё на том же домене, и
 * ни CORS, ни отдельного адреса не существует как вопроса.
 *
 * Вход — тот же ключ, которым работает командная строка. Ключ живёт в
 * sessionStorage вкладки и уходит заголовком; в адресе его нет никогда, иначе
 * он оседал бы в истории браузера и в журналах.
 *
 * Разметка отдаётся без ключа намеренно: сама по себе она пустая, а данные без
 * ключа не отдаются ни на одном маршруте. Прятать форму входа не от кого.
 */

const PAGE = String.raw`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>Тикеты · Мои Приоритеты</title>
<style>
  :root {
    --neon: 53, 224, 255;
    --bg: #08090b;
    --card: #0f1114;
    --line: rgba(255,255,255,.1);
    --dim: #8a8f98;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: #e8eaed;
    font: 400 15px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  button, input, textarea, select { font: inherit; color: inherit; }
  .bar {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 12px 16px; border-bottom: 1px solid var(--line);
    position: sticky; top: 0; background: var(--bg); z-index: 2;
  }
  .bar h1 { margin: 0; font-size: 13px; letter-spacing: .1em; text-transform: uppercase; color: var(--dim); }
  .grow { flex: 1; }
  .tabs { display: flex; gap: 6px; flex-wrap: wrap; }
  .tab {
    padding: 6px 12px; border: 1px solid var(--line); border-radius: 999px;
    background: transparent; cursor: pointer; color: var(--dim); font-size: 13px;
  }
  .tab[aria-selected="true"] { border-color: rgb(var(--neon)); color: rgb(var(--neon)); }
  .wrap { display: grid; grid-template-columns: minmax(280px, 380px) 1fr; gap: 16px; padding: 16px; align-items: start; }
  @media (max-width: 860px) { .wrap { grid-template-columns: 1fr; } .detail:empty { display: none; } }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .item {
    text-align: left; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px;
    background: var(--card); cursor: pointer; display: grid; gap: 4px;
  }
  .item[aria-current="true"] { border-color: rgb(var(--neon)); }
  .item b { font-weight: 600; font-size: 14px; }
  .meta { color: var(--dim); font-size: 12px; font-variant-numeric: tabular-nums; }
  .detail { border: 1px solid var(--line); border-radius: 12px; background: var(--card); padding: 16px; }
  /* Кадр телефона — почти две тысячи пикселей высотой, и без потолка он уводил
     бы поле правки и кнопки за нижний край экрана. Целиком он открывается
     нажатием, а здесь важнее, чтобы «Отправить на фикс» была на виду. */
  .detail img { display: block; width: 100%; max-height: 46vh; object-fit: contain;
                object-position: top; background: #000;
                border: 1px solid var(--line); border-radius: 10px; cursor: zoom-in; }
  .detail img.full { max-height: none; cursor: zoom-out; }
  .detail h2 { margin: 0 0 4px; font-size: 16px; }
  textarea { width: 100%; min-height: 90px; padding: 10px 12px; border: 1px solid var(--line);
             border-radius: 10px; background: rgba(255,255,255,.04); resize: vertical; }
  textarea:focus { outline: none; border-color: rgb(var(--neon)); }
  .row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  .btn { padding: 9px 14px; border: 1px solid var(--line); border-radius: 10px; background: transparent; cursor: pointer; }
  .btn:hover { background: rgba(255,255,255,.06); }
  .btn--main { border-color: rgb(var(--neon)); background: rgb(var(--neon)); color: #08090b; font-weight: 600; }
  /* Удаление стоит отдельной строкой и выглядит иначе: соседство с «Сохранить»
     рано или поздно кончилось бы промахом, а отменить его нечем. */
  .btn--danger { border-color: rgba(255,90,90,.45); color: #ff8f8f; }
  .btn--danger:hover { background: rgba(255,90,90,.12); }
  .row--danger { justify-content: flex-end; margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--line); }
  .btn:disabled { opacity: .4; cursor: default; }
  pre { margin: 8px 0 0; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,.04);
        overflow: auto; font-size: 12px; max-height: 320px; }
  .login { max-width: 380px; margin: 12vh auto; padding: 0 16px; display: grid; gap: 12px; }
  .login input { padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: rgba(255,255,255,.04); }
  .note { color: var(--dim); font-size: 13px; }
  .err { color: #ff8f8f; font-size: 13px; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px;
         border: 1px solid var(--line); color: var(--dim); }
</style>
</head>
<body>
<div id="app"></div>
<script>
const KEY = 'devkit:admin';
const LABELS = { open: 'Новые', queued: 'В работе', closed: 'Починено', wontfix: 'Не чиним' };
let token = sessionStorage.getItem(KEY) || '';
let tab = 'open';
let tickets = [];
let current = null;
let shotUrl = null;
let busy = false;

const app = document.getElementById('app');
const el = (tag, props = {}, kids = []) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const kid of [].concat(kids)) node.append(kid);
  return node;
};

async function api(path, init = {}) {
  const response = await fetch(path, {
    ...init,
    headers: { 'X-Devkit-Token': token, ...(init.headers || {}) },
  });
  if (response.status === 401) { token = ''; sessionStorage.removeItem(KEY); throw new Error('Ключ не подошёл'); }
  if (!response.ok) throw new Error('Сервер ответил ' + response.status);
  return response;
}

function renderLogin(message) {
  const field = el('input', { type: 'password', placeholder: 'Ключ DEVKIT_TOKEN', autofocus: true });
  const enter = async () => {
    token = field.value.trim();
    if (!token) return;
    try {
      await api('/devkit/tickets?status=open&limit=1');
      sessionStorage.setItem(KEY, token);
      load();
    } catch (error) { renderLogin(error.message); }
  };
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });
  app.replaceChildren(el('div', { className: 'login' }, [
    el('h1', { textContent: 'Тикеты' }),
    el('p', { className: 'note', textContent: 'Тот же ключ, которым работает npm run tickets:pull.' }),
    field,
    el('button', { className: 'btn btn--main', textContent: 'Войти', onclick: enter }),
    message ? el('p', { className: 'err', textContent: message }) : '',
  ]));
}

function when(value) {
  return value ? String(value).replace('T', ' ').slice(0, 16) : '—';
}

function renderList() {
  return el('div', { className: 'list' }, tickets.length
    ? tickets.map((t) => el('button', {
        className: 'item',
        ariaCurrent: String(current && current.id === t.id),
        onclick: () => open(t.id),
      }, [
        el('b', { textContent: t.note.slice(0, 90) }),
        el('span', { className: 'meta', textContent:
          t.id.slice(0, 8) + ' · ' + t.app + ' · ' + (t.route || '—') + ' · ' + when(t.created_at) }),
      ]))
    : [el('p', { className: 'note', textContent: 'Здесь пусто.' })]);
}

function act(label, main, run, extra) {
  return el('button', {
    className: 'btn' + (main ? ' btn--main' : '') + (extra ? ' ' + extra : ''),
    textContent: label, disabled: busy,
    onclick: async () => { busy = true; draw(); try { await run(); } catch (e) { alert(e.message); } busy = false; },
  });
}

/**
 * Удаление — единственное необратимое действие на этой странице, поэтому
 * спрашивает подтверждение и называет номер: «удалить» без номера слишком
 * похоже на «удалить не тот».
 */
async function remove() {
  const short = current.id.slice(0, 8);
  if (!confirm('Удалить тикет ' + short + ' вместе с кадром? Это навсегда.')) return;
  await api('/devkit/tickets/' + current.id, { method: 'DELETE' });
  if (shotUrl) { URL.revokeObjectURL(shotUrl); shotUrl = null; }
  current = null;
  await load();
}

async function patch(body) {
  const response = await api('/devkit/tickets/' + current.id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  current = await response.json();
  await load(current.id);
}

function renderDetail() {
  if (!current) return el('div', { className: 'detail' });
  const note = el('textarea', { value: current.note });
  const payload = JSON.parse(current.payload || '{}');
  const env = payload.env || {};

  return el('div', { className: 'detail' }, [
    el('h2', { textContent: 'Тикет ' + current.id.slice(0, 8) }),
    el('p', { className: 'meta', textContent:
      [LABELS[current.status], current.app, current.route || '—', 'сборка ' + (current.build_id || '—'),
       when(current.created_at)].join(' · ') }),
    shotUrl ? el('img', { src: shotUrl, alt: '', onclick: (e) => e.target.classList.toggle('full') })
            : el('p', { className: 'note', textContent: payload.shotError ? 'Кадра нет: ' + payload.shotError : 'Кадра нет.' }),
    el('p', { className: 'meta', textContent: 'Описание — можно поправить перед отправкой в работу:' }),
    note,
    el('div', { className: 'row' }, [
      act('Сохранить описание', false, () => patch({ note: note.value })),
      current.status !== 'queued'
        ? act('Отправить на фикс', true, () => patch({ note: note.value, status: 'queued' }))
        : act('Вернуть в новые', false, () => patch({ status: 'open' })),
      act('Не чиним', false, () => patch({ status: 'wontfix' })),
    ]),
    el('p', { className: 'meta', textContent: 'Куда ткнули: ' + ((payload.target || {}).path || '—') }),
    el('p', { className: 'meta', textContent:
      'Клиент: ' + JSON.stringify(env.client || {}) + ' · окно ' +
      ((env.viewport || {}).w || '?') + '×' + ((env.viewport || {}).h || '?') }),
    el('details', {}, [
      el('summary', { className: 'meta', textContent: 'Журнал и состояние' }),
      el('pre', { textContent:
        (payload.log || []).map((l) => String(l.at).padStart(7) + ' мс  ' + l.kind + '  ' + l.text).join('\n') +
        '\n\n' + JSON.stringify(payload.snapshot || {}, null, 2) }),
    ]),
    el('div', { className: 'row row--danger' }, [act('Удалить', false, remove, 'btn--danger')]),
  ]);
}

function draw() {
  if (!token) return renderLogin();
  app.replaceChildren(
    el('div', { className: 'bar' }, [
      el('h1', { textContent: 'Тикеты' }),
      el('div', { className: 'tabs' }, Object.keys(LABELS).map((key) => el('button', {
        className: 'tab', textContent: LABELS[key], role: 'tab',
        onclick: () => { tab = key; current = null; load(); },
      }, []))),
      el('span', { className: 'grow' }),
      el('button', { className: 'btn', textContent: 'Обновить', onclick: () => load(current && current.id) }),
    ]),
    el('div', { className: 'wrap' }, [renderList(), renderDetail()]),
  );
  for (const node of app.querySelectorAll('.tab')) {
    node.setAttribute('aria-selected', String(LABELS[tab] === node.textContent));
  }
}

async function open(id) {
  const response = await api('/devkit/tickets/' + id);
  current = await response.json();
  if (shotUrl) { URL.revokeObjectURL(shotUrl); shotUrl = null; }
  draw();
  if (current.shot_key) {
    try {
      const shot = await api('/devkit/tickets/' + id + '/shot');
      shotUrl = URL.createObjectURL(await shot.blob());
      draw();
    } catch { /* кадр мог не разойтись по хранилищу — не повод ронять страницу */ }
  }
}

async function load(keepId) {
  try {
    const response = await api('/devkit/tickets?status=' + tab + '&limit=100');
    tickets = (await response.json()).tickets || [];
    draw();
    if (keepId) await open(keepId);
  } catch (error) { renderLogin(error.message); }
}

if (token) load(); else renderLogin();
</script>
</body>
</html>`;

export function adminPage(): Response {
  return new Response(PAGE, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Страница живая и меняется вместе с воркером — кэшировать нечего.
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
