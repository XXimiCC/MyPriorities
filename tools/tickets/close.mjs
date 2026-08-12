/*
 * Закрыть тикет и убрать рабочую копию.
 *
 *   npm run tickets:close -- a3f9c1 "что сделано"
 *   npm run tickets:close -- a3f9c1 "не воспроизводится" --wontfix
 *
 * Идентификатор принимается началом: показываются восемь символов, а ключом в
 * базе остаётся весь — совпадение в показе не должно становиться совпадением в
 * хранилище.
 *
 * Локальная папка удаляется здесь же: закрытый тикет, оставшийся на диске,
 * приводит к тому, что его чинят второй раз.
 */

import fs from 'node:fs';
import path from 'node:path';

import { TICKETS_DIR, api, log, readConfig } from './config.mjs';

async function main() {
  const args = process.argv.slice(2);
  const wontfix = args.includes('--wontfix');
  const [id, note] = args.filter((value) => !value.startsWith('--'));

  if (!id) {
    throw new Error('Нужен номер тикета: npm run tickets:close -- a3f9c1 "что сделано"');
  }

  const config = readConfig();
  const response = await api(config, `/devkit/tickets/${id}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: note ?? '', wontfix }),
  });

  const result = await response.json();

  /* Каталог ищем по идентификатору внутри, а не по имени: при совпадении начал
     у двух тикетов имя длиннее восьми символов, и угадывать его нельзя. */
  if (fs.existsSync(TICKETS_DIR)) {
    for (const name of fs.readdirSync(TICKETS_DIR)) {
      const dir = path.join(TICKETS_DIR, name);
      let kept;
      try {
        kept = JSON.parse(fs.readFileSync(path.join(dir, 'payload.json'), 'utf8')).id;
      } catch {
        continue;
      }
      if (kept === result.id) fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  log(`${result.id.slice(0, 8)} · ${result.status === 'wontfix' ? 'не чиним' : 'закрыт'}`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
