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
 * Клиент открыл мини-апп полноэкранным.
 *
 * Отметку читает отсюда telegram/sdk.ts: к моменту, когда до него дойдёт
 * очередь, спрашивать isFullscreen уже поздно — ответом будет «нет». А сам факт
 * — половина ответа на жалобы «окно прыгает в угол» и «пропали кнопки
 * навигации»: режим включает клиент, и по своему коду приложение о нём не знает.
 */
export let openedFullscreen = false;

/**
 * Выход из полноэкранного режима — здесь, а не в telegram/sdk.ts, и причина
 * ровно одна: время.
 *
 * Режим приложение не заказывает никогда, его включает клиент — так настраивается
 * ссылка мини-аппа. На компьютере мини-апп это отдельное окно фиксированного
 * размера, и растянуть его может единственная вещь — этот самый режим: Telegram
 * Desktop выдаёт окно размером с экран, но оставляет на месте, рассчитанном под
 * обычное, — оно уезжает за правый нижний край. Выход возвращает окну обычный
 * размер, а вот прежнего положения у окна нет, восстанавливать не из чего —
 * отсюда прыжок в левый верхний угол. Смотрит человек на всё это ровно до
 * выхода, поэтому выход стоит здесь, кадром после самого SDK, а не после того,
 * как выполнится чанк приложения со всеми его модулями.
 *
 * Проверки версии тут намеренно нет. Клиенты занижают заявленную версию (та же
 * причина расписана у cloudStorage в sdk.ts), и isVersionAtLeast('8.0')
 * выключал бы выход ровно там, где он нужнее всего. Наличие самих isFullscreen
 * и exitFullscreen и есть ответ на вопрос, умеет ли клиент режим: вне 8.0 их
 * просто нет.
 */
function leaveFullscreen(): void {
  const app = window.Telegram?.WebApp;
  if (!app?.isFullscreen || typeof app.exitFullscreen !== 'function') return;
  openedFullscreen = true;
  app.exitFullscreen();
}

/**
 * Ставит SDK, если он нужен и его ещё нет. Промис не отвергается никогда:
 * отсутствие SDK — это деградация, а не остановка, и решать, что делать
 * дальше, будет telegram/sdk.ts по `isTelegram`.
 */
export function loadTelegramSdk(): Promise<void> {
  if (!launchedFromTelegram()) return Promise.resolve();
  // Стаб съёмки (tools/shots/telegram-stub.js) приезжает до страницы — грузить нечего.
  if (window.Telegram?.WebApp) {
    leaveFullscreen();
    return Promise.resolve();
  }

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
    script.onload = () => {
      // Раньше finish(): окну незачем ждать даже разбора промиса.
      leaveFullscreen();
      finish();
    };
    script.onerror = () => finish('ошибка сети');
    document.head.appendChild(script);
  });
}
