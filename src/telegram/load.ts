/**
 * Загрузка telegram-web-app.js.
 *
 * Раньше скрипт стоял в index.html обычным тегом до модуля: он блокировал
 * парсер, и первый кадр приложения ждал ответа telegram.org. Замер под WebKit
 * на 390×844 — 292 мс, когда домен отвечает; 5147 мс, когда он отвечает за пять
 * секунд; 132 мс, когда его нет вовсе. Само приложение в SDK не нуждается, а
 * человек в мобильной сети платил за него чёрным экраном ровно во столько.
 * `defer` тут не помогает: отложенный классический скрипт и модуль выполняются
 * одним списком по порядку документа, так что модуль всё равно ждал бы.
 *
 * Поэтому скрипт грузится отсюда и только там, где нужен, — внутри клиента
 * Telegram. Это снимает и вторую его цену: вне клиента SDK всё равно
 * подставлял объект с версией 6.0, и каждая сессия в браузере начиналась с
 * четырёх «is not supported in version 6.0» в консоли, в которых тонут
 * настоящие ошибки.
 *
 * Своей копии скрипта не заводим сознательно — по той же причине, по которой
 * его не кэширует public/sw.js: telegram.org/js меняется у Telegram, а не у
 * нас, и застывшая копия SDK — это застывший баг.
 */

const SRC = 'https://telegram.org/js/telegram-web-app.js';

/**
 * Предел ожидания.
 *
 * Внутри клиента SDK обязателен: без него нет CloudStorage, и вся сессия
 * запишется только на это устройство. Поэтому ждём заметно дольше, чем ждали бы
 * необязательный ресурс. Но не бесконечно: мёртвая сеть иначе даёт чёрный экран
 * без конца, а приложение и без облака остаётся полностью рабочим.
 */
const TIMEOUT_MS = 6000;

/** Ключ, под которым SDK держит параметры запуска между перезагрузками. */
const SESSION_KEY = '__telegram__initParams';

/**
 * Мини-апп запущен клиентом Telegram — вопрос, на который можно ответить без
 * всякого SDK, и в этом весь смысл.
 *
 * Клиент передаёт параметры запуска хэшем (`#tgWebAppPlatform=…`) и вставляет в
 * вебвью свой мост ещё до того, как страница начала грузиться. Ни то, ни другое
 * от telegram.org не зависит, поэтому сбой сети больше не может выдать мини-апп
 * за обычную вкладку браузера — а именно так и терялись данные: `isTelegram`
 * становился ложным, и приложение уходило в локальное хранилище.
 */
export function launchedFromTelegram(): boolean {
  if (typeof window === 'undefined') return false;

  const url = window.location;
  if (url.hash.includes('tgWebApp') || url.search.includes('tgWebApp')) return true;
  // Мост клиента: Android и Desktop вставляют свой объект, iOS — обработчик в webkit.
  if ('TelegramWebviewProxy' in window || 'TelegramWebviewProxyProto' in window) return true;

  try {
    return window.sessionStorage.getItem(SESSION_KEY) !== null;
  } catch {
    // Хранилище закрыто настройками приватности. Не повод считать, что мы не в Telegram.
    return false;
  }
}

/**
 * Ставит SDK, если он нужен и его ещё нет. Промис не отвергается никогда:
 * отсутствие SDK — это деградация, а не остановка, и решать, что делать
 * дальше, будет telegram/sdk.ts по `isTelegram`.
 */
export function loadTelegramSdk(): Promise<void> {
  if (!launchedFromTelegram()) return Promise.resolve();
  // Стаб съёмки (tools/shots/telegram-stub.js) приезжает до страницы — грузить нечего.
  if (window.Telegram?.WebApp) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (reason?: string): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (reason) {
        console.warn(
          `[telegram] SDK не загрузился (${reason}): облака в этой сессии не будет, пишем на устройство`,
        );
      }
      resolve();
    };

    const timer = window.setTimeout(() => finish('превышено ожидание'), TIMEOUT_MS);

    const script = document.createElement('script');
    script.src = SRC;
    script.onload = () => finish();
    script.onerror = () => finish('ошибка сети');
    document.head.appendChild(script);
  });
}
