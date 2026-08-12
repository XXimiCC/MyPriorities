import { beforeEach, describe, expect, it } from 'vitest';

import { inviteFromSearch, inviteKey, rememberInvite, resolveInvite } from './invite';

/** sessionStorage в node нет — подставляем простейшую. */
class Session implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private kept = new Map<string, string>();
  getItem(key: string): string | null {
    return this.kept.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.kept.set(key, value);
  }
  removeItem(key: string): void {
    this.kept.delete(key);
  }
}

beforeEach(() => {
  (globalThis as { sessionStorage?: unknown }).sessionStorage = new Session();
  rememberInvite(undefined);
});

describe('ключ из ссылки', () => {
  it('читается из адреса', () => {
    expect(inviteFromSearch('?test=abc123')).toBe('abc123');
    expect(inviteFromSearch('?mock=1&test=abc123&x=2')).toBe('abc123');
  });

  it('пустой параметр ключом не считается', () => {
    // Иначе `?test=` открывал бы панель кому угодно.
    expect(inviteFromSearch('?test=')).toBeUndefined();
    expect(inviteFromSearch('?test=%20%20')).toBeUndefined();
  });

  it('без параметра — ничего', () => {
    expect(inviteFromSearch('')).toBeUndefined();
    expect(inviteFromSearch('?demo=f')).toBeUndefined();
  });
});

describe('память о ключе', () => {
  it('держится на время сеанса', () => {
    rememberInvite('abc');
    expect(inviteKey()).toBe('abc');
  });

  it('сбрасывается пустым значением', () => {
    rememberInvite('abc');
    rememberInvite(undefined);
    expect(inviteKey()).toBeUndefined();
  });

  it('переживает переход на другую страницу', () => {
    // Документация многостраничная: параметр из адреса пропадает вместе со
    // страницей, а тестировщик — нет.
    expect(resolveInvite('?test=abc')).toBe('abc');
    rememberInvite(undefined);
    (globalThis as { sessionStorage?: unknown }).sessionStorage = Object.assign(new Session(), {
      getItem: () => 'abc',
    });
    expect(resolveInvite('')).toBe('abc');
  });

  it('отсутствие ключа в адресе не стирает запомненный', () => {
    resolveInvite('?test=abc');
    expect(resolveInvite('/dev/devkit')).toBe('abc');
  });

  it('новый ключ вытесняет старый', () => {
    resolveInvite('?test=abc');
    expect(resolveInvite('?test=xyz')).toBe('xyz');
  });
});
