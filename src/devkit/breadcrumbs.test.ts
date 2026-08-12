import { beforeEach, describe, expect, it } from 'vitest';

import {
  installBreadcrumbs,
  pushBreadcrumb,
  readBreadcrumbs,
  resetBreadcrumbsForTests,
  type BreadcrumbTargets,
} from './breadcrumbs';

/** Подставные цели: настоящих console и window тут нет и не нужно. */
function targets(): BreadcrumbTargets & { said: string[]; listeners: string[] } {
  const said: string[] = [];
  const listeners: string[] = [];
  return {
    said,
    listeners,
    console: {
      error: (...args: unknown[]) => said.push(`error ${String(args[0])}`),
      warn: (...args: unknown[]) => said.push(`warn ${String(args[0])}`),
    },
    addEventListener: (type) => listeners.push(type),
    removeEventListener: (type) => listeners.push(`-${type}`),
  };
}

beforeEach(() => {
  resetBreadcrumbsForTests();
});

describe('кольцо', () => {
  it('не растёт дальше тридцати', () => {
    for (let index = 0; index < 45; index += 1) pushBreadcrumb('action', `шаг ${index}`);
    const log = readBreadcrumbs(Date.now());
    expect(log).toHaveLength(30);
    // Осталось последнее, а не первое: важнее то, что было перед жалобой.
    expect(log[log.length - 1]?.text).toBe('шаг 44');
  });

  it('время становится смещением от момента жалобы', () => {
    pushBreadcrumb('error', 'упало');
    const [entry] = readBreadcrumbs(Date.now() + 1000);
    expect(entry?.at).toBeLessThanOrEqual(-1000);
  });

  it('длинный текст обрезается', () => {
    pushBreadcrumb('error', 'я'.repeat(5000));
    expect(readBreadcrumbs(Date.now())[0]?.text.length).toBe(300);
  });
});

describe('перехват консоли', () => {
  it('возвращает управление настоящей', () => {
    const target = targets();
    installBreadcrumbs(target);

    target.console.error('не сохранилось');

    expect(target.said).toEqual(['error не сохранилось']);
    expect(readBreadcrumbs(Date.now())[0]?.kind).toBe('error');
  });

  it('вычищает аргументы', () => {
    // Иначе console.error('не сохранилось', settings) увёз бы все настройки.
    const target = targets();
    installBreadcrumbs(target);

    target.console.warn('плохо', { title: 'Терапия', blockMinutes: 30 });

    const text = readBreadcrumbs(Date.now())[0]?.text ?? '';
    expect(text).not.toContain('Терапия');
    expect(text).toContain('blockMinutes');
  });

  it('повторная установка не удваивает записи', () => {
    // Двойное монтирование и перезагрузка модуля в разработке — обычное дело.
    const target = targets();
    installBreadcrumbs(target);
    installBreadcrumbs(target);

    target.console.error('раз');

    expect(readBreadcrumbs(Date.now())).toHaveLength(1);
    expect(target.said).toEqual(['error раз']);
  });

  it('снимается только после последней отписки', () => {
    const target = targets();
    const first = installBreadcrumbs(target);
    const second = installBreadcrumbs(target);

    first();
    target.console.error('ещё пишется');
    expect(readBreadcrumbs(Date.now())).toHaveLength(1);

    second();
    target.console.error('уже нет');
    expect(readBreadcrumbs(Date.now())).toHaveLength(1);
    expect(target.listeners).toEqual(['error', 'unhandledrejection', '-error', '-unhandledrejection']);
  });
});
