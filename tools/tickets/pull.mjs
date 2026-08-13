/*
 * Забрать тикеты, отправленные в работу, и разложить по .tickets/.
 *
 *   npm run tickets:pull             — забрать очередь на починку
 *   npm run tickets:pull -- --open   — забрать новые, минуя отбор
 *   npm run tickets:list             — только показать список, ничего не писать
 *   npm run tickets:pull -- --force  — перезаписать уже лежащее
 *
 * По умолчанию берутся не все новые тикеты, а только отобранные руками в
 * админке (`/devkit/admin`, кнопка «Отправить на фикс»). Разница существенная:
 * входящий поток — это сырые жалобы, среди которых бывают и повторы, и
 * «показалось». Чинить их подряд означает делать отбор дважды.
 *
 * Файлами на диске, а не выводом в консоль: нейронка читает ticket.md и кадр
 * своими обычными инструментами, а картинка в терминал не помещается.
 *
 * Каталог .tickets/ закрыт .gitignore — внутри кадры экрана с настоящими
 * данными, им в репозитории не место.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { TICKETS_DIR, api, log, readConfig } from './config.mjs';
import { renderTicket } from './render.mjs';

const EXTENSIONS = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

/** Чей это каталог. undefined — либо чужой мусор, либо недокачанный тикет. */
function idOf(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'payload.json'), 'utf8')).id;
  } catch {
    return undefined;
  }
}

/**
 * Куда положить тикет.
 *
 * Имя каталога — начало идентификатора: так его читают и так же набирают в
 * команде закрытия. Но если начало совпало у двух разных тикетов, короткого
 * имени не хватает — и тогда берётся длиннее. Прежняя версия в этом случае
 * молча пропускала второй тикет, приняв чужой каталог за уже выгруженный.
 */
export function folderFor(id, base = TICKETS_DIR) {
  for (const size of [8, 12, id.length]) {
    const name = id.slice(0, size);
    const dir = path.join(base, name);
    if (!fs.existsSync(dir)) return { dir, name, already: false };
    if (idOf(dir) === id) return { dir, name, already: true };
  }
  throw new Error(`не подобрать имя каталога для ${id}`);
}

async function main() {
  const args = process.argv.slice(2);
  const listOnly = args.includes('--list');
  const force = args.includes('--force');
  const status = args.includes('--open') ? 'open' : 'queued';
  const config = readConfig();

  const response = await api(config, `/devkit/tickets?status=${status}&limit=50`);
  const { tickets } = await response.json();

  if (!tickets || tickets.length === 0) {
    log(
      status === 'queued'
        ? 'В работе ничего нет. Отберите тикеты в админке либо возьмите новые: npm run tickets:pull -- --open'
        : 'Новых тикетов нет.',
    );
    return;
  }

  if (listOnly) {
    for (const row of tickets) {
      log(`${row.id.slice(0, 8)}  ${row.created_at}  ${row.route ?? '—'}  ${row.note.slice(0, 60)}`);
    }
    return;
  }

  let fresh = 0;
  for (const row of tickets) {
    const { dir, name: short, already } = folderFor(row.id);
    if (already && !force) continue;

    fs.mkdirSync(dir, { recursive: true });

    let shotName;
    if (row.shot_key) {
      try {
        const shot = await api(config, `/devkit/tickets/${row.id}/shot`);
        shotName = `shot.${EXTENSIONS[row.shot_mime] ?? 'bin'}`;
        fs.writeFileSync(path.join(dir, shotName), Buffer.from(await shot.arrayBuffer()));
      } catch (error) {
        // Кадр мог ещё не разойтись по KV — он согласован в конечном счёте.
        // Тикет без кадра полезнее, чем упавшая команда.
        log(`  ${short}: кадр не забрался (${error.message})`);
      }
    }

    // payload.json пишется первым: по нему каталог потом узнаёт сам себя.
    fs.writeFileSync(path.join(dir, 'payload.json'), `${row.payload}\n`);
    fs.writeFileSync(path.join(dir, 'ticket.md'), renderTicket(row, shotName));
    fresh += 1;
    log(`${short} · ${row.route ?? '—'} · ${row.note.slice(0, 60)}`);
  }

  log(fresh > 0 ? `\n${fresh} шт. · ${path.relative(process.cwd(), TICKETS_DIR)}/` : 'Новых нет.');
}

/* Запуск только когда файл вызвали как команду. Импортировать его ради одной
   чистой функции должно быть безопасно — это делает сторож в tools/tickets.test.ts. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
