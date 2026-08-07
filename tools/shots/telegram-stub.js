/*
 * Подделка window.Telegram.WebApp для прогона C.
 *
 * Нужна ровно затем, что три состояния интерфейса недостижимы в голом браузере:
 * «Аккаунт Telegram» в блоке данных (src/telegram/cloudStorage.ts:214 выбирает
 * localStore, когда облака нет), кнопка ярлыка на главный экран (Bot API 8.0) и
 * ручное сохранение обои-картинки (вне Telegram срабатывает <a download>).
 *
 * Файл читается как текст и уходит в page.addInitScript, поэтому здесь не может
 * быть ни импортов, ни экспортов — только один вызов функции.
 */

(() => {
  const cloud = new Map();

  // Telegram зовёт колбэк асинхронно; синхронный вызов маскировал бы гонки,
  // которые в настоящем клиенте есть.
  const later = (fn) => setTimeout(fn, 0);

  const webApp = {
    initData: 'stub',
    initDataUnsafe: { user: { id: 1, language_code: 'ru' } },
    platform: 'ios',
    version: '8.0',
    colorScheme: 'dark',
    themeParams: {},
    viewportHeight: 844,
    viewportStableHeight: 844,
    safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
    contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },

    isVersionAtLeast: () => true,
    ready() {},
    expand() {},
    disableVerticalSwipes() {},
    setHeaderColor() {},
    setBackgroundColor() {},
    setBottomBarColor() {},
    onEvent() {},
    offEvent() {},

    // Все подтверждения принимаются: снимок делается уже после подтверждения,
    // а отказ — отдельный сценарий, который снимать нечем (диалог рисует клиент).
    showConfirm: (_message, cb) => later(() => cb && cb(true)),
    showAlert: (_message, cb) => later(() => cb && cb()),

    HapticFeedback: {
      impactOccurred() {},
      notificationOccurred() {},
      selectionChanged() {},
    },

    BackButton: {
      show() {},
      hide() {},
      onClick() {},
      offClick() {},
    },

    CloudStorage: {
      getItems: (keys, cb) => {
        const out = {};
        keys.forEach((key) => {
          out[key] = cloud.get(key) ?? '';
        });
        later(() => cb(null, out));
      },
      setItem: (key, value, cb) => {
        cloud.set(key, value);
        later(() => cb && cb(null, true));
      },
      removeItems: (keys, cb) => {
        keys.forEach((key) => cloud.delete(key));
        later(() => cb && cb(null, true));
      },
      getKeys: (cb) => later(() => cb(null, [...cloud.keys()])),
    },

    // 'missed' — ярлыка ещё нет, значит кнопка в настройках показывается.
    checkHomeScreenStatus: (cb) => later(() => cb && cb('missed')),
    addToHomeScreen() {},

    downloadFile: (_params, cb) => later(() => cb && cb(false)),
  };

  window.Telegram = { WebApp: webApp };
})();
