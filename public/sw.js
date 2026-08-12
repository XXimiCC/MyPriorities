/*
 * Кэш приложения: офлайн и мгновенный старт.
 *
 * Главное ограничение, из которого следует всё остальное: документ обязан
 * приходить свежим. В index.html встроены хешированные имена ассетов и отметка
 * сборки (__BUILD_ID__), и отданный из кэша документ воскресил бы мёртвую
 * версию — вопрос «доехало ли на прод» перестал бы иметь ответ, а ради ответа
 * на него отметка сборки и существует (vite.config.ts). Vercel отдаёт документ
 * с no-cache; воркер обязан вести себя так же.
 *
 * Workbox не взят сознательно. Он оправдан прекешем манифеста сборки и десятком
 * стратегий на разные типы ресурсов; здесь ресурсов два (один JS-чанк и один
 * CSS), стратегий тоже две, и пятнадцать килобайт рантайма с build-плагином
 * стоили бы дороже шестидесяти строк.
 *
 * Где воркер НЕ ставится и почему — в src/main.tsx.
 *
 * Аварийное снятие: если воркер придётся убрать, содержимое этого файла
 * заменяется на unregister() с очисткой caches, и старые версии снимут себя
 * сами при следующем заходе. Порядок описан в docs/dev/release.md.
 */

/*
 * Версия приходит строкой запроса: регистрация идёт по sw.js?v=<BUILD_ID>.
 * Смена адреса скрипта — это для браузера новый воркер, то есть установка и
 * очистка чужих кэшей на активации. Константа в файле требовала бы поднимать
 * её руками (и однажды её забудут), а подстановка при сборке невозможна:
 * public/ Vite не обрабатывает.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') ?? 'dev';
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;

/*
 * Ключ документа один на все входы: /, /?demo=max, /?code=… и /#tgWebAppData —
 * это один и тот же index.html, и хранить его четырьмя копиями незачем.
 */
const DOCUMENT = './';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Документ кладём сразу: без него первый же заход без сети дал бы
      // «нет соединения» вместо приложения, которое умеет работать локально.
      const shell = await caches.open(SHELL);
      await shell.add(new Request(DOCUMENT, { cache: 'reload' }));
      /*
       * skipWaiting здесь безопасен по конкретной причине: сборка даёт ровно
       * один JS и один CSS, кода с ленивой подгрузкой нет (единственный import()
       * в src/sync/device.ts Rollup инлайнит). Значит очистка старого кэша на
       * активации не может выдернуть чанк из-под уже открытой страницы.
       * ПОЯВИТСЯ CODE SPLITTING — ЭТО РАССУЖДЕНИЕ ПЕРЕСТАНЕТ БЫТЬ ВЕРНЫМ.
       */
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== SHELL && name !== ASSETS) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  /*
   * Чужое мимо. telegram.org/js меняется у Telegram, а не у нас, и застывшая
   * копия SDK — это застывший баг; ответы воркера синхронизации кэшировать
   * нельзя тем более: журнал операций перестал бы доезжать.
   */
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(documentFirst(request));
  } else if (url.pathname.includes('/assets/')) {
    event.respondWith(assetFirst(request));
  }
  // Всё прочее — манифест, иконки — идёт мимо воркера: меняется раз в год,
  // и обычного HTTP-кэша ему хватает.
});

/** Документ: только из сети. Кэш — исключительно на случай, когда сети нет. */
async function documentFirst(request) {
  const shell = await caches.open(SHELL);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) await shell.put(DOCUMENT, fresh.clone());
    return fresh;
  } catch {
    const cached = await shell.match(DOCUMENT);
    if (cached) return cached;
    throw new Error('нет сети и нет копии документа');
  }
}

/** Ассеты: имя содержит хеш содержимого, поэтому попадание в кэш всегда верно. */
async function assetFirst(request) {
  const assets = await caches.open(ASSETS);
  const cached = await assets.match(request);
  if (cached) return cached;

  const fresh = await fetch(request);
  if (fresh.ok) await assets.put(request, fresh.clone());
  return fresh;
}
