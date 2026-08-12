/**
 * Кольцевой журнал последних ошибок.
 *
 * Ставится сразу при монтировании панели, до всякого жеста: ошибки, достойные
 * отчёта, случились раньше, чем панель понадобилась. Цена — около килобайта
 * всегда включённого кода и перехваченный console.
 *
 * Цели передаются аргументом, а не берутся из глобалей, по двум причинам:
 * так это проверяется в node без jsdom, и так видно, что модуль трогает ровно
 * два метода консоли и два события, а не «что-нибудь ещё».
 *
 * Установка идемпотентна и считает ссылки: второе монтирование (перезагрузка
 * модуля в разработке, второй экземпляр панели) не должно ни удвоить записи,
 * ни устроить рекурсию «перехваченный console.error зовёт перехваченный».
 */

import { redact } from './redact';
import type { LogEntry } from './types';

const RING = 30;
const MAX_TEXT = 300;
const MAX_STACK = 2000;

export interface BreadcrumbTargets {
  console: { error(...args: unknown[]): void; warn(...args: unknown[]): void };
  addEventListener(type: 'error' | 'unhandledrejection', handler: (event: unknown) => void): void;
  removeEventListener(type: 'error' | 'unhandledrejection', handler: (event: unknown) => void): void;
}

interface Kept {
  at: number;
  kind: LogEntry['kind'];
  text: string;
  stack?: string;
}

let ring: Kept[] = [];
let installs = 0;
let uninstall: (() => void) | undefined;

/** Одна строка из аргументов console: каждый прошёл вычистку на глубину один. */
function describe(args: unknown[]): string {
  const parts = args.map((arg) => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    try {
      return JSON.stringify(redact(arg, 1));
    } catch {
      return String(arg);
    }
  });
  return parts.join(' ').slice(0, MAX_TEXT);
}

export function pushBreadcrumb(kind: LogEntry['kind'], text: string, stack?: string): void {
  ring.push({ at: Date.now(), kind, text: text.slice(0, MAX_TEXT), stack: stack?.slice(0, MAX_STACK) });
  if (ring.length > RING) ring = ring.slice(-RING);
}

export function installBreadcrumbs(targets: BreadcrumbTargets): () => void {
  installs += 1;
  if (installs === 1) {
    const realError = targets.console.error;
    const realWarn = targets.console.warn;

    const onError = (event: unknown): void => {
      const detail = event as { message?: unknown; error?: { stack?: unknown } };
      pushBreadcrumb(
        'onerror',
        typeof detail.message === 'string' ? detail.message : 'ошибка',
        typeof detail.error?.stack === 'string' ? detail.error.stack : undefined,
      );
    };

    const onRejection = (event: unknown): void => {
      const reason = (event as { reason?: unknown }).reason;
      if (reason instanceof Error) pushBreadcrumb('rejection', `${reason.name}: ${reason.message}`, reason.stack);
      else pushBreadcrumb('rejection', describe([reason]));
    };

    targets.console.error = (...args: unknown[]): void => {
      pushBreadcrumb('error', describe(args));
      realError.apply(targets.console, args);
    };
    targets.console.warn = (...args: unknown[]): void => {
      pushBreadcrumb('warn', describe(args));
      realWarn.apply(targets.console, args);
    };
    targets.addEventListener('error', onError);
    targets.addEventListener('unhandledrejection', onRejection);

    uninstall = () => {
      targets.console.error = realError;
      targets.console.warn = realWarn;
      targets.removeEventListener('error', onError);
      targets.removeEventListener('unhandledrejection', onRejection);
    };
  }

  return () => {
    installs = Math.max(0, installs - 1);
    if (installs === 0) {
      uninstall?.();
      uninstall = undefined;
    }
  };
}

/**
 * Забрать копию журнала. Время переводится в смещение от момента жалобы:
 * «за секунду до» читается, а отметка 1786... — нет.
 */
export function readBreadcrumbs(now: number): LogEntry[] {
  return ring.map((entry) => {
    const line: LogEntry = { at: entry.at - now, kind: entry.kind, text: entry.text };
    if (entry.stack) line.stack = entry.stack;
    return line;
  });
}

/** Только для тестов: кольцо и счётчик установок живут в модуле. */
export function resetBreadcrumbsForTests(): void {
  ring = [];
  installs = 0;
  uninstall = undefined;
}
