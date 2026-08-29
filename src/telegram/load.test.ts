/**
 * Запуск из Telegram определяется без самого SDK — и это главное, что здесь
 * проверяется.
 *
 * Пока признаком был `window.Telegram`, любой сбой сети превращал мини-апп в
 * обычную вкладку: `isTelegram` становился ложным, приложение выбирало
 * локальное хранилище вместо облака и записи сессии никуда не уезжали. Обратная
 * сторона той же монеты — скрипт, который грузился и там, где не нужен вовсе.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { launchedFromTelegram, loadTelegramSdk } from './load';

interface Launch {
  hash?: string;
  search?: string;
  /** Что отдаёт sessionStorage: строка, null или бросок (приватный режим). */
  session?: string | null | 'throws';
  bridge?: boolean;
  /** window.Telegram.WebApp: true — пустышка, объект — свой. */
  telegram?: boolean | Record<string, unknown>;
}

interface FakeScript {
  src?: string;
  onload?: () => void;
  onerror?: () => void;
}

/** Ровно те поля окна и документа, которые читает load.ts. */
function pretend(launch: Launch = {}): FakeScript[] {
  const added: FakeScript[] = [];

  const win: Record<string, unknown> = {
    location: { hash: launch.hash ?? '', search: launch.search ?? '' },
    sessionStorage: {
      getItem(): string | null {
        if (launch.session === 'throws') throw new Error('хранилище закрыто');
        return launch.session ?? null;
      },
    },
    // Не bind: таймеры подменяются на поддельные уже после этого вызова.
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: number) => globalThis.clearTimeout(id),
  };
  if (launch.bridge) win.TelegramWebviewProxy = {};
  if (launch.telegram) win.Telegram = { WebApp: launch.telegram === true ? {} : launch.telegram };

  vi.stubGlobal('window', win);
  vi.stubGlobal('document', {
    createElement: (): FakeScript => ({}),
    head: {
      appendChild(node: FakeScript) {
        added.push(node);
      },
    },
  });

  return added;
}

/** Скрипт SDK объявляет window.Telegram, когда выполнится, — не раньше. */
function defineTelegram(webApp: Record<string, unknown>): void {
  (globalThis.window as unknown as Record<string, unknown>).Telegram = { WebApp: webApp };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('признак запуска из Telegram', () => {
  it('обычная вкладка браузера — не Telegram', () => {
    pretend({ search: '?lang=en' });
    expect(launchedFromTelegram()).toBe(false);
  });

  it('параметры запуска в хэше', () => {
    pretend({ hash: '#tgWebAppPlatform=ios&tgWebAppVersion=8.0' });
    expect(launchedFromTelegram()).toBe(true);
  });

  it('мост клиента, вставленный в вебвью', () => {
    // Единственный признак, который переживает и сбой сети, и подчищенный хэш.
    pretend({ bridge: true });
    expect(launchedFromTelegram()).toBe(true);
  });

  it('параметры, пережившие перезагрузку в sessionStorage', () => {
    pretend({ session: '{"tgWebAppPlatform":"android"}' });
    expect(launchedFromTelegram()).toBe(true);
  });

  it('закрытое хранилище не роняет проверку и не выдаёт вкладку за клиент', () => {
    pretend({ session: 'throws' });
    expect(launchedFromTelegram()).toBe(false);

    vi.unstubAllGlobals();
    pretend({ hash: '#tgWebAppData=x', session: 'throws' });
    expect(launchedFromTelegram()).toBe(true);
  });
});

describe('загрузка SDK', () => {
  it('вне Telegram не грузится вовсе', async () => {
    const added = pretend();
    await loadTelegramSdk();
    expect(added).toEqual([]);
  });

  it('внутри Telegram ставится скрипт клиента', async () => {
    const added = pretend({ hash: '#tgWebAppPlatform=ios' });
    const done = loadTelegramSdk();

    expect(added).toHaveLength(1);
    expect(added[0]!.src).toBe('https://telegram.org/js/telegram-web-app.js');

    added[0]!.onload!();
    await expect(done).resolves.toBeUndefined();
  });

  it('готовый SDK второй раз не грузится', async () => {
    const added = pretend({ hash: '#tgWebAppPlatform=ios', telegram: true });
    await loadTelegramSdk();
    expect(added).toEqual([]);
  });

  it('отказ сети не подвешивает старт', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const added = pretend({ bridge: true });
    const done = loadTelegramSdk();

    added[0]!.onerror!();

    await expect(done).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('молчащий CDN отпускает старт по истечении ожидания', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    pretend({ bridge: true });

    const done = loadTelegramSdk();
    // Ни onload, ни onerror: домен принял соединение и молчит — ровно тот
    // случай, ради которого предел и стоит.
    await vi.advanceTimersByTimeAsync(6000);

    await expect(done).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

/**
 * Выход из полноэкранного режима стоит здесь, а не в sdk.ts, ровно ради одного:
 * между SDK и первой строчкой приложения лежит целый чанк, и всё это время окно
 * на компьютере растянуто за краем экрана.
 */
describe('полноэкранный режим', () => {
  /** Отметка живёт в модуле: без свежей копии соседний тест читал бы чужую. */
  async function fresh(): Promise<typeof import('./load')> {
    vi.resetModules();
    return import('./load');
  }

  it('выход происходит сразу за скриптом SDK, до приложения', async () => {
    const exitFullscreen = vi.fn();
    const added = pretend({ hash: '#tgWebAppPlatform=tdesktop' });
    const load = await fresh();

    const done = load.loadTelegramSdk();
    defineTelegram({ isFullscreen: true, exitFullscreen });
    added[0]!.onload!();
    await done;

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(load.openedFullscreen).toBe(true);
  });

  it('обычное окно не трогаем и отметку не ставим', async () => {
    const exitFullscreen = vi.fn();
    const added = pretend({ hash: '#tgWebAppPlatform=tdesktop' });
    const load = await fresh();

    const done = load.loadTelegramSdk();
    defineTelegram({ isFullscreen: false, exitFullscreen });
    added[0]!.onload!();
    await done;

    expect(exitFullscreen).not.toHaveBeenCalled();
    expect(load.openedFullscreen).toBe(false);
  });

  it('клиент без режима вовсе не роняет старт', async () => {
    // Ни isFullscreen, ни exitFullscreen: всё, что старше Bot API 8.0.
    const added = pretend({ hash: '#tgWebAppPlatform=tdesktop' });
    const load = await fresh();

    const done = load.loadTelegramSdk();
    defineTelegram({});
    added[0]!.onload!();

    await expect(done).resolves.toBeUndefined();
    expect(load.openedFullscreen).toBe(false);
  });

  it('готовый SDK разбирается тем же путём', async () => {
    // Стаб съёмки приезжает до страницы: грузить нечего, а выходить — есть откуда.
    const exitFullscreen = vi.fn();
    pretend({ hash: '#tgWebAppPlatform=tdesktop', telegram: { isFullscreen: true, exitFullscreen } });
    const load = await fresh();

    await load.loadTelegramSdk();

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(load.openedFullscreen).toBe(true);
  });
});
