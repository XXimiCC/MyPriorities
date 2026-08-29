/**
 * Типизированная обёртка над window.Telegram.WebApp.
 *
 * Всё здесь обязано работать и в обычном браузере, где Telegram нет вовсе:
 * каждый вызов сначала проверяет наличие метода и нужную версию Bot API,
 * а при отсутствии тихо деградирует. Благодаря этому весь остальной код
 * пишется без единой проверки `if (webApp)`.
 */

import { launchedFromTelegram, openedFullscreen } from './load';

type HapticStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type NotificationType = 'error' | 'success' | 'warning';

interface SafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface CloudStorageApi {
  getItem(key: string, cb: (err: string | null, value?: string) => void): void;
  getItems(keys: string[], cb: (err: string | null, values?: Record<string, string>) => void): void;
  setItem(key: string, value: string, cb?: (err: string | null, ok?: boolean) => void): void;
  removeItem(key: string, cb?: (err: string | null, ok?: boolean) => void): void;
  removeItems(keys: string[], cb?: (err: string | null, ok?: boolean) => void): void;
  getKeys(cb: (err: string | null, keys?: string[]) => void): void;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    user?: { id: number; first_name?: string; language_code?: string };
    /** Хвост ссылки-приглашения: t.me/<бот>/app?startapp=<это>. */
    start_param?: string;
  };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  viewportStableHeight?: number;
  safeAreaInset?: SafeAreaInset;
  contentSafeAreaInset?: SafeAreaInset;
  isFullscreen?: boolean;
  exitFullscreen?(): void;

  ready(): void;
  expand(): void;
  close(): void;
  isVersionAtLeast(version: string): boolean;

  disableVerticalSwipes?(): void;
  enableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  onEvent(event: string, handler: () => void): void;
  offEvent(event: string, handler: () => void): void;

  BackButton: {
    isVisible: boolean;
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  HapticFeedback?: {
    impactOccurred(style: HapticStyle): void;
    notificationOccurred(type: NotificationType): void;
    selectionChanged(): void;
  };
  CloudStorage?: CloudStorageApi;

  showAlert?(message: string, cb?: () => void): void;
  showConfirm?(message: string, cb?: (confirmed: boolean) => void): void;

  addToHomeScreen?(): void;
  checkHomeScreenStatus?(cb: (status: string) => void): void;
  downloadFile?(params: { url: string; file_name: string }, cb?: (accepted: boolean) => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

// typeof-проверка нужна не ради SSR, а чтобы модуль можно было импортировать
// из юнит-тестов в node: цепочка persistence → cloudStorage → sdk тянется всегда.
const webApp: TelegramWebApp | undefined =
  typeof window === 'undefined' ? undefined : window.Telegram?.WebApp;

function atLeast(version: string): boolean {
  try {
    return webApp?.isVersionAtLeast(version) ?? false;
  } catch {
    return false;
  }
}

/**
 * Внутри клиента Telegram? Определяет и выбор хранилища, и доступность нативных диалогов.
 *
 * Признак берётся не только из SDK. Скрипт приезжает по сети (telegram/load.ts),
 * и когда он не доехал, `window.Telegram` нет вовсе — проверка по одному только
 * объекту объявила бы мини-апп обычной вкладкой браузера со всеми последствиями:
 * service worker поверх вебвью, локальное хранилище вместо облака, онбординг
 * вместо данных. Запуск же виден в параметрах и в мосте клиента и от сети
 * не зависит.
 */
export const isTelegram =
  launchedFromTelegram() ||
  Boolean(webApp && webApp.initData !== undefined && webApp.platform !== 'unknown');

/** Мы внутри клиента, но SDK не доехал: облака в этой сессии не будет. Видно в отчётах девкита. */
export const sdkMissing = isTelegram && !webApp;

/**
 * Признак реального клиента, а не версия.
 *
 * Раньше здесь стояло isVersionAtLeast('6.9'), и это было ошибкой: клиенты
 * занижают заявленную версию вебвью (Telegram Desktop сообщает старую, хотя
 * CloudStorage у него есть). Проверка отсекала облако целиком, приложение молча
 * уходило в localStorage — на телефоне данные были, на компьютере тот же аккаунт
 * открывался онбордингом.
 *
 * От шума в обычном браузере защищает isTelegram: там platform === 'unknown'.
 * А если вызов всё-таки не пройдёт, обёртка в cloudStorage.ts переключится
 * на локальное хранилище сама.
 */
export const cloudStorage: CloudStorageApi | undefined =
  isTelegram && webApp?.CloudStorage ? webApp.CloudStorage : undefined;

/** Для диагностики в настройках: без этого «почему не синхронизируется» не разобрать. */
export const clientInfo = {
  platform: webApp?.platform ?? 'браузер',
  version: webApp?.version ?? '—',
  isTelegram,
  /*
   * Клиент открыл приложение полноэкранно. Заполняется до того, как режим будет
   * выключен: без этой отметки жалобы «окно прыгает в угол» и «пропали кнопки
   * навигации» неотличимы от любых других — сам режим приложение не заказывает
   * и по своему коду о нём не знает.
   *
   * Начальное значение приезжает от telegram/load.ts: выйти из режима нужно
   * задолго до этого модуля, а спрашивать isFullscreen после него уже поздно —
   * ответом будет «нет».
   */
  openedFullscreen,
};

/**
 * Клиенты, где мини-апп открывается отдельным окном, а не шторкой снизу.
 * Разворачивать там нечего: окно и так своего размера, а expand() на нём
 * растягивает его во весь экран — вместе с заголовком, за который окно
 * перетаскивают. Пользователь получает приложение, которое нельзя ни
 * подвинуть, ни уменьшить.
 */
const WINDOWED = new Set(['tdesktop', 'macos']);

/**
 * Доля от высоты вебвью, ниже которой заявленная клиентом высота — не тесное
 * окно, а протухшее значение. Половина: реально клиент отъедает шапкой и
 * панелью десятки точек, а не сотни.
 */
const TRUSTED_SHARE = 0.5;

/**
 * Высота видимой части приложения.
 *
 * Именно stable-высота: обычная viewportHeight скачет вместе с клавиатурой и
 * вместе с ней прыгал бы весь каркас.
 *
 * Но верить ей на слово нельзя. Свёрнутый мини-апп Telegram превращает в
 * полоску у нижней кромки экрана и честно сообщает её высоту; при обратном
 * разворачивании событие с новым значением приходит не всегда. Приложение
 * остаётся жить в сотне точек: шапка, обрезанный переключатель периода и
 * чёрное поле под ними. Что каркас схлопнулся, по экрану не видно — таб-бар
 * прибит к окну, а не к каркасу, и остаётся на своём месте внизу.
 *
 * Высота самого вебвью к этому моменту уже полная, поэтому расхождение вдвое
 * и означает: клиент своё значение обновить не успел, верим окну.
 */
function appHeight(): number {
  const inner = window.innerHeight;
  const stable = webApp?.viewportStableHeight ?? 0;
  return stable >= inner * TRUSTED_SHARE ? stable : inner;
}

/**
 * Прокидывает геометрию Telegram в CSS-переменные: env() внутри вебвью врёт,
 * а 100dvh не учитывает шапку клиента и панель снизу.
 */
function syncViewport(): void {
  const root = document.documentElement;
  const safe = webApp?.safeAreaInset;
  const content = webApp?.contentSafeAreaInset;
  if (safe) {
    root.style.setProperty('--safe-top', `${safe.top}px`);
    root.style.setProperty('--safe-bottom', `${safe.bottom}px`);
  }
  if (content) {
    root.style.setProperty('--tg-content-top', `${content.top}px`);
    root.style.setProperty('--tg-content-bottom', `${content.bottom}px`);
  }
  // Ноль приезжает от спрятанного вебвью: записать его — значит своими руками
  // сделать тот самый чёрный экран. Прежнее значение переживёт этот момент,
  // а следующий замер по таймеру всё равно придёт.
  const height = appHeight();
  if (height > 0) root.style.setProperty('--app-height', `${height}px`);
}

/**
 * Замер по сигналу — трижды: сразу, следующим кадром и через паузу.
 *
 * Событие о смене размеров приходит раньше, чем клиент пересчитывает вебвью:
 * один замер в момент сигнала списывает старое значение. Повторы стоят три
 * присваивания CSS-переменных и снимают целый класс «развернул — чёрный экран».
 */
let recheck: number | undefined;

function resyncViewport(): void {
  syncViewport();
  window.requestAnimationFrame(syncViewport);
  window.clearTimeout(recheck);
  recheck = window.setTimeout(syncViewport, 400);
}

/**
 * Полноэкранный режим (Bot API 8.0) приложение не заказывает никогда, но клиент
 * может открыть его сам — так настраивается ссылка мини-аппа. Хорошего в этом
 * ничего: на компьютере окно теряет заголовок и перестаёт двигаться, на Android
 * система прячет свою панель навигации, и первое касание по ней только
 * возвращает кнопки, а не нажимает их — их приходится нащупывать.
 *
 * Своя шапка у приложения есть, а клиентская рамка вокруг нужна: в неё вынесены
 * «назад» и закрытие.
 *
 * Первый выход делает telegram/load.ts, кадром после SDK: между ним и этим
 * модулем лежит целый чанк приложения, и всё это время окно на компьютере стоит
 * растянутым за краем экрана. Здесь выход остаётся для клиента, который включит
 * режим позже, — по fullscreenChanged.
 *
 * Проверки версии нет по той же причине, что и там: клиенты занижают заявленную
 * версию, и isVersionAtLeast('8.0') выключал бы выход ровно там, где он нужнее
 * всего.
 */
function leaveFullscreen(): void {
  if (!webApp?.isFullscreen || typeof webApp.exitFullscreen !== 'function') return;
  clientInfo.openedFullscreen = true;
  webApp.exitFullscreen();
}

/** Вызывается один раз до первого рендера. */
export function initTelegram(): void {
  if (!webApp) return;

  webApp.ready();
  leaveFullscreen();
  if (!WINDOWED.has(webApp.platform)) webApp.expand();

  // Без этого жест "потянуть вниз, чтобы закрыть" перехватывает перетаскивание
  // приоритетов и любой скролл у верхней кромки списка.
  if (atLeast('7.7')) webApp.disableVerticalSwipes?.();

  webApp.setHeaderColor?.('#000000');
  webApp.setBackgroundColor?.('#000000');
  if (atLeast('7.10')) webApp.setBottomBarColor?.('#000000');

  syncViewport();
  /* Подписки версией не ограничены, и это не небрежность: onEvent просто кладёт
     обработчик в список, а событие, которого клиент не умеет, не придёт и так.
     Зато isVersionAtLeast у занизившего версию клиента отнял бы и те события,
     которые он умеет, — ровно так однажды пропало облачное хранилище. */
  webApp.onEvent('safeAreaChanged', syncViewport);
  webApp.onEvent('contentSafeAreaChanged', syncViewport);
  /* Единственное событие про возвращение из свёрнутого состояния:
     viewportChanged после него приходит не всегда. */
  webApp.onEvent('activated', resyncViewport);
  webApp.onEvent('fullscreenChanged', () => {
    leaveFullscreen();
    resyncViewport();
  });
  webApp.onEvent('viewportChanged', resyncViewport);

  /* Страховка от промолчавшего клиента: размер вебвью меняется в любом случае,
     и об этом сообщает уже само окно, а не Telegram. */
  window.addEventListener('resize', resyncViewport);
  window.addEventListener('orientationchange', resyncViewport);
  window.visualViewport?.addEventListener('resize', resyncViewport);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resyncViewport();
  });
}

// --- Тактильная отдача -------------------------------------------------------

export const haptics = {
  tap(): void {
    webApp?.HapticFeedback?.impactOccurred('light');
  },
  bump(): void {
    webApp?.HapticFeedback?.impactOccurred('medium');
  },
  select(): void {
    webApp?.HapticFeedback?.selectionChanged();
  },
  success(): void {
    webApp?.HapticFeedback?.notificationOccurred('success');
  },
  warning(): void {
    webApp?.HapticFeedback?.notificationOccurred('warning');
  },
};

// --- Кнопка «назад» ----------------------------------------------------------

/**
 * Кнопка «назад» — стек, а не одиночный обработчик.
 *
 * Экраны вкладываются: поверх вложенного экрана открывается шторка, поверх неё
 * может открыться ещё одна. Если просто вешать обработчики один на другой, то
 * нажатие «назад» срабатывает сразу на всех, а закрытие верхнего слоя прячет
 * кнопку, хотя нижний ещё открыт. Поэтому активен всегда ровно один обработчик —
 * верхний, — а кнопка прячется только когда стек опустел.
 */
const backStack: Array<() => void> = [];
let boundHandler: (() => void) | undefined;

function syncBackButton(): void {
  if (!webApp) return;
  const top = backStack[backStack.length - 1];

  if (boundHandler && boundHandler !== top) {
    webApp.BackButton.offClick(boundHandler);
    boundHandler = undefined;
  }
  if (top && boundHandler !== top) {
    webApp.BackButton.onClick(top);
    boundHandler = top;
  }

  if (top) webApp.BackButton.show();
  else webApp.BackButton.hide();
}

export const backButton = {
  show(handler: () => void): () => void {
    if (!webApp) return () => {};
    backStack.push(handler);
    syncBackButton();

    return () => {
      const index = backStack.lastIndexOf(handler);
      if (index >= 0) backStack.splice(index, 1);
      syncBackButton();
    };
  },
  hide(): void {
    backStack.length = 0;
    syncBackButton();
  },
};

// --- Диалоги -----------------------------------------------------------------

/** Нативный confirm в Telegram, window.confirm в браузере. */
export function confirmDialog(message: string): Promise<boolean> {
  if (webApp?.showConfirm && atLeast('6.2')) {
    return new Promise((resolve) => {
      webApp.showConfirm!(message, (ok) => resolve(Boolean(ok)));
    });
  }
  return Promise.resolve(window.confirm(message));
}

export function alertDialog(message: string): Promise<void> {
  if (webApp?.showAlert && atLeast('6.2')) {
    return new Promise((resolve) => {
      webApp.showAlert!(message, () => resolve());
    });
  }
  window.alert(message);
  return Promise.resolve();
}

// --- Ярлык на главном экране (Bot API 8.0) -----------------------------------

export const homeScreen = {
  supported(): boolean {
    return Boolean(webApp?.addToHomeScreen) && atLeast('8.0');
  },
  add(): void {
    webApp?.addToHomeScreen?.();
  },
  /** 'unsupported' | 'unknown' | 'added' | 'missed' */
  status(): Promise<string> {
    if (!webApp?.checkHomeScreenStatus || !atLeast('8.0')) return Promise.resolve('unsupported');
    return new Promise((resolve) => {
      let settled = false;
      const done = (s: string) => {
        if (!settled) {
          settled = true;
          resolve(s);
        }
      };
      // Часть клиентов заявляет метод, но колбэк не вызывает — не подвешиваем UI.
      const timer = window.setTimeout(() => done('unknown'), 2500);
      webApp.checkHomeScreenStatus!((s) => {
        window.clearTimeout(timer);
        done(s || 'unknown');
      });
    });
  },
};

// --- Сохранение файла --------------------------------------------------------

export const files = {
  /** downloadFile принимает только публичный URL — blob: и data: он не берёт. */
  canDownloadUrl(): boolean {
    return Boolean(webApp?.downloadFile) && atLeast('8.0');
  },
  downloadUrl(url: string, fileName: string): void {
    webApp?.downloadFile?.({ url, file_name: fileName });
  },
};

export const platform = webApp?.platform ?? 'web';
export const userId = webApp?.initDataUnsafe?.user?.id;

/**
 * Хвост ссылки, по которой открыли мини-апп. Приезжает в хэше и переживает
 * перезагрузку страницы — единственный способ передать что-то приложению,
 * когда адрес задан настройками бота, а не отправителем.
 */
export const startParam = webApp?.initDataUnsafe?.start_param;

/**
 * Подписанная строка входа. Уходит на сервер как есть — проверять подпись
 * может только тот, у кого токен бота, и это не приложение.
 *
 * Пустая строка вне Telegram: там вход появится отдельным путём, через
 * Telegram Login в браузере.
 */
export const initData = webApp?.initData ?? '';
