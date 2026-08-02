/**
 * Типизированная обёртка над window.Telegram.WebApp.
 *
 * Всё здесь обязано работать и в обычном браузере, где Telegram нет вовсе:
 * каждый вызов сначала проверяет наличие метода и нужную версию Bot API,
 * а при отсутствии тихо деградирует. Благодаря этому весь остальной код
 * пишется без единой проверки `if (webApp)`.
 */

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
  initDataUnsafe?: { user?: { id: number; first_name?: string; language_code?: string } };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  viewportStableHeight?: number;
  safeAreaInset?: SafeAreaInset;
  contentSafeAreaInset?: SafeAreaInset;

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

/** Внутри клиента Telegram? Определяет и выбор хранилища, и доступность нативных диалогов. */
export const isTelegram = Boolean(webApp && webApp.initData !== undefined && webApp.platform !== 'unknown');

/**
 * Проверка версии обязательна, а не только наличия объекта: в обычном браузере
 * telegram-web-app.js всё равно создаёт WebApp с версией 6.0, где CloudStorage
 * ещё нет. Без этой проверки каждое чтение и запись уходили бы в заведомо
 * провальный вызов и сорили ошибками в консоль, прежде чем упасть на localStorage.
 */
export const cloudStorage: CloudStorageApi | undefined = atLeast('6.9')
  ? webApp?.CloudStorage
  : undefined;

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
  // Именно stable-высота: обычная viewportHeight скачет вместе с клавиатурой
  // и вместе с ней прыгал бы весь каркас.
  const height = webApp?.viewportStableHeight;
  if (height) root.style.setProperty('--app-height', `${height}px`);
}

/** Вызывается один раз до первого рендера. */
export function initTelegram(): void {
  if (!webApp) return;

  webApp.ready();
  webApp.expand();

  // Без этого жест "потянуть вниз, чтобы закрыть" перехватывает перетаскивание
  // приоритетов и любой скролл у верхней кромки списка.
  if (atLeast('7.7')) webApp.disableVerticalSwipes?.();

  webApp.setHeaderColor?.('#000000');
  webApp.setBackgroundColor?.('#000000');
  if (atLeast('7.10')) webApp.setBottomBarColor?.('#000000');

  syncViewport();
  if (atLeast('8.0')) {
    webApp.onEvent('safeAreaChanged', syncViewport);
    webApp.onEvent('contentSafeAreaChanged', syncViewport);
  }
  webApp.onEvent('viewportChanged', syncViewport);
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

export const backButton = {
  show(handler: () => void): () => void {
    if (!webApp) return () => {};
    webApp.BackButton.onClick(handler);
    webApp.BackButton.show();
    return () => {
      webApp.BackButton.offClick(handler);
      webApp.BackButton.hide();
    };
  },
  hide(): void {
    webApp?.BackButton.hide();
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
