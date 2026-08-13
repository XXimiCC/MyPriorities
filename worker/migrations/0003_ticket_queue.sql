-- Очередь на починку: между «пришло» и «закрыто» появилось «взято в работу».
--
-- Смысл состояния — разделить два разных вопроса. «Открыт» отвечает на «нам об
-- этом сообщили»; «в работе» — на «я это посмотрел и отправил чинить». Без
-- второго admin-страница и командная строка видели бы одно и то же, и отбор
-- глазами пришлось бы делать заново при каждой выгрузке.
--
-- Таблица пересобирается целиком: в SQLite ограничение CHECK нельзя изменить
-- иначе. Данные переносятся as-is, индексы создаются заново. Миграции
-- применяются по одному разу (учёт ведёт сам wrangler), поэтому
-- неидемпотентность здесь безопасна.

create table tickets_next (
  id          text primary key,
  user_id     text,
  telegram_id integer,
  app         text not null,
  status      text not null default 'open'
              check (status in ('open', 'queued', 'closed', 'wontfix')),
  note        text not null,
  payload     text not null,
  build_id    text,
  route       text,
  shot_key    text,
  shot_bytes  integer,
  shot_mime   text,
  created_at  text not null default (datetime('now')),
  -- Когда отправили чинить. Нужно не ради истории, а ради порядка в очереди:
  -- разбирают в том порядке, в каком отбирали.
  queued_at   text,
  closed_at   text,
  fix_note    text,
  closed_by   text
);

insert into tickets_next
  (id, user_id, telegram_id, app, status, note, payload, build_id, route,
   shot_key, shot_bytes, shot_mime, created_at, closed_at, fix_note, closed_by)
select
   id, user_id, telegram_id, app, status, note, payload, build_id, route,
   shot_key, shot_bytes, shot_mime, created_at, closed_at, fix_note, closed_by
from tickets;

drop table tickets;
alter table tickets_next rename to tickets;

create index if not exists tickets_status on tickets (status, created_at);
create index if not exists tickets_user   on tickets (user_id, created_at);
create index if not exists tickets_queue  on tickets (status, queued_at);
