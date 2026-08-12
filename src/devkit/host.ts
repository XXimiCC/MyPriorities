/**
 * Реестр адаптера — единственный шов между панелью и приложением.
 *
 * Модульная переменная, а не контекст React: панель живёт в отдельном корне и
 * обязана пережить падение приложения, а контекст умер бы вместе с деревом.
 *
 * Все обращения к хозяину идут через `ask`. Тикет о белом экране — самый
 * ценный из всех, и он приходит ровно тогда, когда `route()` или `snapshot()`
 * зовут в дерево, которого уже нет. Поэтому упавший вызов не исключение, а
 * запись в списке отказов: она уедет в тикет полем `hostError`.
 */

import type { DevkitHost } from './types';

let host: DevkitHost | undefined;
let failures: string[] = [];

export function registerDevkitHost(next: DevkitHost): void {
  host = next;
}

export function currentHost(): DevkitHost | undefined {
  return host;
}

/**
 * Спросить хозяина. Отказ не всплывает: вернётся undefined, а причина ляжет в
 * список и уедет в тикет.
 */
export function ask<T>(label: string, read: (h: DevkitHost) => T): T | undefined {
  if (!host) return undefined;
  try {
    return read(host);
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/** Забрать накопленные отказы и очистить список. Зовётся один раз на тикет. */
export function takeHostError(): string | undefined {
  if (failures.length === 0) return undefined;
  const text = failures.join(' · ');
  failures = [];
  return text;
}
