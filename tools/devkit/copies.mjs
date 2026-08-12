import path from 'node:path';

/*
 * Куда кладётся собранная панель отладки.
 *
 * Отдельный файл, а не константа в build.mjs, по той же причине, что и
 * tools/landing/shots.mjs: список нужен и сборщику, и сторожу в тестах, а
 * импортировать сборщик ради константы значило бы запускать сборку на каждом
 * `npm test`.
 *
 * Каталоги лежат внутри Root Directory своих проектов Vercel — иначе файлы туда
 * просто не доедут.
 */
export const DEVKIT_COPIES = [
  path.join('docs', 'public', 'devkit'),
  path.join('landing', 'public', 'devkit'),
];
