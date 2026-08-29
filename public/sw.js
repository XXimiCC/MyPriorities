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
 * стратегий на разные типы ресурсов; здесь стратегий две — документ из сети,
 * ассеты из кэша, — и пятнадцать килобайт рантайма с build-плагином стоили бы
 * дороже шестидесяти строк.
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

/*
 * Кэш ассетов — БЕЗ версии, и это принципиально.
 *
 * Пока сборка давала один JS и один CSS, версия в имени была безобидна. Теперь
 * есть code splitting (React.lazy на брендките, два import() в девките), и
 * версионное имя ломало сразу две вещи. Первая — открытая вкладка: новый воркер
 * делает skipWaiting, на активации сносил бы кэш предыдущей версии и забирал
 * вкладку себе, а её ленивый кусок ушёл бы в сеть, где после выкатки старых
 * имён уже нет. Вторая — трафик: каждая пересборка выбрасывала все ассеты,
 * включая побайтово не изменившиеся.
 *
 * Общее имя безопасно ровно потому, что имена файлов содержат хеш содержимого:
 * столкнуться двум разным версиям одного файла в одном ключе нечем.
 */
const ASSETS = 'assets';

/**
 * Потолок кэша ассетов. Имена уникальны, поэтому старые записи не вытесняются
 * сами — их снимаем на активации. Шести десятков хватает примерно на восемь
 * выкаток вперёд, то есть открытая с прошлой сборки вкладка своё переживёт.
 */
const ASSETS_LIMIT = 60;

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
       * skipWaiting безопасен, пока кэш ассетов общий на все версии (см. ASSETS):
       * забирая открытую вкладку себе, новый воркер не уносит из-под неё её
       * собственные чанки. КЭШ АССЕТОВ СНОВА СТАНЕТ ВЕРСИОННЫМ — ЭТО РАССУЖДЕНИЕ
       * ПЕРЕСТАНЕТ БЫТЬ ВЕРНЫМ.
       *
       * Документ вкладка при этом держит свой, уже отрисованный: он приходит из
       * сети и в кэше лежит только на случай её отсутствия.
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
      await pruneAssets();
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

/**
 * Снимает лишнее с головы кэша ассетов. Cache API отдаёт ключи в порядке
 * добавления, поэтому первыми уходят самые старые — то есть чанки тех сборок,
 * вкладок с которыми давно нет.
 */
async function pruneAssets() {
  const assets = await caches.open(ASSETS);
  const keys = await assets.keys();
  for (const request of keys.slice(0, keys.length - ASSETS_LIMIT)) {
    await assets.delete(request);
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
