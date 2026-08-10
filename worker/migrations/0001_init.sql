-- Схема D1.
--
-- D1 — это SQLite, поэтому jsonb здесь обычный text с JSON внутри, а
-- «bigint identity» — integer primary key autoincrement: он даёт глобально
-- монотонный rowid, а больше от курсора синхронизации ничего и не нужно.
--
-- Строковых типов SQLite не проверяет, поэтому формы, на которые опирается код
-- (месяц, день), закреплены check-ограничениями: тихо принятый мусор в журнале
-- дороже отказа на записи.

create table if not exists profiles (
  user_id            text primary key,
  -- nullable намеренно: вход сегодня только через Telegram, но Apple может
  -- потребовать альтернативу, и добавление второй идентичности не должно
  -- ломать схему задним числом.
  telegram_id        integer unique,
  username           text,
  -- Отметка о разовом переносе данных из CloudStorage и хеш перенесённого:
  -- повторный прогон с тем же хешем не должен ничего делать.
  legacy_imported_at text,
  legacy_import_hash text,
  created_at         text not null default (datetime('now'))
);

-- Устройства нужны не ради списка в настройках, а ради барьера свёртки:
-- свернуть журнал можно только до места, которое забрали все живые устройства.
create table if not exists devices (
  user_id       text not null references profiles(user_id) on delete cascade,
  device_id     text not null,
  platform      text,
  last_seen_seq integer not null default 0,
  last_seen_at  text not null default (datetime('now')),
  primary key (user_id, device_id)
);

-- Refresh-токены лежат хешами: утечка базы не даёт войти.
create table if not exists sessions (
  token_hash text primary key,
  user_id    text not null references profiles(user_id) on delete cascade,
  device_id  text,
  expires_at text not null,
  -- Предъявленный дважды refresh — признак кражи: гасим всю цепочку устройства.
  revoked    integer not null default 0,
  created_at text not null default (datetime('now'))
);
create index if not exists sessions_user on sessions (user_id, device_id);

-- Настройки и каталог навыков: связные объекты, которые меняются редко и едут
-- целиком. Побеждает запись с большей меткой.
create table if not exists documents (
  user_id    text not null references profiles(user_id) on delete cascade,
  kind       text not null check (kind in ('settings', 'skills')),
  body       text not null,
  hlc        text not null,
  device_id  text not null,
  updated_at text not null default (datetime('now')),
  primary key (user_id, kind)
);

-- Журнал операций. Только вставка: правит его одна лишь свёртка.
create table if not exists ops (
  server_seq integer primary key autoincrement,
  user_id    text not null references profiles(user_id) on delete cascade,
  op_id      text not null,
  kind       text not null,
  hlc        text not null,
  device_id  text not null,
  day        text check (day is null or day glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  target_id  text,
  minute     integer check (minute is null or (minute between 0 and 1440)),
  amount     integer,
  level      integer check (level is null or (level between 1 and 4)),
  created_at text not null default (datetime('now'))
);
-- Идемпотентность доставки: повторная отправка той же пачки ничего не меняет.
create unique index if not exists ops_user_op  on ops (user_id, op_id);
create index        if not exists ops_user_seq on ops (user_id, server_seq);
create index        if not exists ops_user_day on ops (user_id, day);

-- Свёрнутый архив: операции старше окна складываются сюда и из журнала уходят.
-- Без этого журнал растёт линейно и упирается в тариф за пару тысяч человек.
create table if not exists month_snapshots (
  user_id     text not null references profiles(user_id) on delete cascade,
  scope       text not null check (scope in ('clicks', 'skills', 'battery')),
  month       text not null check (month glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  body        text not null,
  through_seq integer not null,
  updated_at  text not null default (datetime('now')),
  primary key (user_id, scope, month)
);
