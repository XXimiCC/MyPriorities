/*
 * Тикет в markdown — для нейронки, а не для человека.
 *
 * Порядок разделов — порядок полезности: сначала жалоба словами, потом кадр,
 * потом путь до элемента (по имени класса код находится одним grep), и только
 * затем журнал и окружение. Модель читает сверху вниз, и то, что важнее, должно
 * стоять выше, а не быть аккуратно уложенным в конец.
 *
 * Функция чистая: на вход строка из базы, на выход текст. Поэтому её проверяет
 * tools/tickets.test.ts, а не глаз при первом реальном тикете.
 */

const SHOT_REASONS = {
  'import-failed': 'кусок съёмки не догрузился (обычно офлайн)',
  timeout: 'растеризация не уложилась в отведённое время',
  'raster-failed': 'растеризация упала',
  'encode-failed': 'кадр не закодировался',
  'too-large': 'кадр не ужался до предела',
};

const STATUS = { open: 'открыт', closed: 'закрыт', wontfix: 'не чиним' };

function yesNo(value) {
  return value ? 'да' : 'нет';
}

function flagsLine(flags = {}) {
  const parts = [`демо: ${yesNo(flags.demo)}`, `гость: ${yesNo(flags.guest)}`];
  if ('pwa' in flags) parts.push(`установлено: ${yesNo(flags.pwa)}`);
  return parts.join(' · ');
}

function clientLine(env = {}) {
  const client = env.client ?? {};
  const where = client.telegram ? 'Telegram' : 'браузер';
  const platform = client.platform ? ` \`${client.platform}\`` : '';
  const version = client.version ? ` ${client.version}` : '';
  const view = env.viewport ? ` · окно ${env.viewport.w}×${env.viewport.h}` : '';
  return `${where}${platform}${version} · DPR ${env.dpr ?? '?'}${view}`;
}

function logLines(log = []) {
  if (log.length === 0) return 'Пусто.';
  return [
    '```',
    ...log.map((entry) => `${String(entry.at).padStart(7)} мс  ${entry.kind.padEnd(10)}${entry.text}`),
    '```',
  ].join('\n');
}

function shotBlock(payload, shotName) {
  if (shotName) return `![кадр](./${shotName})`;
  const reason = SHOT_REASONS[payload.shotError] ?? 'причина не записана';
  return `> Кадра нет: ${reason}.`;
}

/**
 * @param row строка из базы, как её отдаёт сервер
 * @param shotName имя файла кадра рядом с ticket.md либо undefined
 */
export function renderTicket(row, shotName) {
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload ?? {});
  const env = payload.env ?? {};
  const short = row.id.slice(0, 8);

  const lines = [
    `# Тикет ${short} · ${STATUS[row.status] ?? row.status}`,
    '',
    `**Что не так.** ${row.note || '(без описания)'}`,
    '',
    '| | |',
    '|---|---|',
    `| Экран | \`${row.route ?? payload.route ?? '—'}\` |`,
    `| Приложение | \`${row.app}\` |`,
    `| От кого | ${row.telegram_id ?? '—'} |`,
    `| Сборка | \`${row.build_id ?? '—'}\` |`,
    `| Когда | ${payload.createdAt ?? row.created_at} |`,
    `| Клиент | ${clientLine(env)} |`,
    `| Режим | ${flagsLine(env.flags)} · сеть: ${yesNo(env.online)} |`,
    '',
    shotBlock(payload, shotName),
    '',
  ];

  if (payload.target) {
    lines.push('## Куда ткнули', '', `\`${payload.target.path}\``, '', '```html', payload.target.html, '```', '');
  }

  lines.push('## Журнал перед отправкой', '', logLines(payload.log), '');

  if (payload.snapshot) {
    lines.push('## Состояние', '', '```json', JSON.stringify(payload.snapshot, null, 2), '```', '');
  }

  if (payload.hostError) {
    // Отдельной строкой, а не в общей куче: «приложение не ответило» — это
    // почти всегда и есть тот баг, ради которого тикет заведён.
    lines.push(`> Приложение не ответило на часть вопросов: ${payload.hostError}`, '');
  }

  lines.push(
    '## Окружение',
    '',
    '```',
    `UA: ${env.ua ?? '—'}`,
    `Экран ${env.screen?.w ?? '?'}×${env.screen?.h ?? '?'}, язык ${env.language ?? '—'}`,
    payload.shot
      ? `Кадр ${payload.shot.mime} ${payload.shot.w}×${payload.shot.h}, ${Math.round(payload.shot.bytes / 1024)} КБ, ` +
        `вырез ${payload.shot.crop.x},${payload.shot.crop.y} ${payload.shot.crop.w}×${payload.shot.crop.h}, ` +
        `штрихов ${payload.shot.strokes}`
      : 'Кадра нет',
    '```',
    '',
    '---',
    `Закрыть: \`npm run tickets:close -- ${short} "что сделано"\``,
    '',
  );

  return lines.join('\n');
}

export { SHOT_REASONS };
