-- Тикеты из встроенной панели отладки.
--
-- Тикет связан с профилем, но внешнего ключа на него нет намеренно: жалоба
-- «после сброса кабинета всё сломалось» обязана пережить сам сброс, иначе
-- каскадное удаление уносит повод вместе с данными.
--
-- Кадр лежит не здесь, а в KV. Картинка в строке D1 съела бы суточную квоту на
-- записанные байты после первого десятка тикетов, а сама база считается по
-- объёму — её размер и есть то, за чем следит ночной отчёт (см. report.ts).

create table if not exists tickets (
  id          text primary key,
  user_id     text,
  telegram_id integer,
  -- Один сервер может обслуживать несколько приложений: панель переносимая.
  app         text not null,
  status      text not null default 'open' check (status in ('open', 'closed', 'wontfix')),
  note        text not null,
  -- Весь автоматический контекст одним JSON: он растёт от версии к версии, и
  -- колонка на каждый новый факт означала бы миграцию на каждый новый факт.
  payload     text not null,
  -- Продублировано из payload ради выборок: по сборке и экрану ищут чаще всего.
  build_id    text,
  route       text,
  -- Ключ значения в KV. null — кадра нет, причина лежит в payload.shotError.
  shot_key    text,
  shot_bytes  integer,
  shot_mime   text,
  created_at  text not null default (datetime('now')),
  closed_at   text,
  -- Чем кончилось: коммит, объяснение или «не воспроизводится».
  fix_note    text,
  closed_by   text
);

create index if not exists tickets_status on tickets (status, created_at);
create index if not exists tickets_user   on tickets (user_id, created_at);
