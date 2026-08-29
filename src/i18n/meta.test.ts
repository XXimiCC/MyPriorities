/**
 * Метаданные установки следуют за языком.
 *
 * То, что читает система, а не человек: заголовок вкладки, описание и две
 * подписи под иконкой на домашнем экране — apple-mobile-web-app-title у iOS и
 * short_name манифеста у всех остальных. В разметке они зашиты один раз и сами
 * не обновятся, а язык по умолчанию английский: пока это не применялось, тот,
 * кто читает по-английски, добавлял на «Домой» иконку с подписью «Приоритеты».
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE = 'https://mypriorities.life/';

interface Page {
  documentElement: { lang: string };
  title: string;
  baseURI: string;
  querySelector(selector: string): unknown;
}

let meta: Record<string, string>;
let manifest: { href: string };
let page: Page;

function open(search: string): void {
  meta = { description: 'из разметки', 'apple-mobile-web-app-title': 'из разметки' };
  manifest = { href: `${BASE}manifest.webmanifest` };
  page = {
    documentElement: { lang: '' },
    title: 'из разметки',
    baseURI: BASE,
    querySelector(selector: string) {
      const name = /^meta\[name="(.+)"\]$/.exec(selector)?.[1];
      if (name) {
        if (!(name in meta)) return null;
        return {
          setAttribute(_attribute: string, value: string) {
            meta[name] = value;
          },
        };
      }
      return selector === 'link[rel="manifest"]' ? manifest : null;
    },
  };

  vi.stubGlobal('window', { location: { search, href: `${BASE}${search}` } });
  vi.stubGlobal('navigator', { language: 'en-US' });
  vi.stubGlobal('document', page);
  vi.resetModules();
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('метаданные установки', () => {
  it('на старте раскладываются на активном языке', async () => {
    open('?lang=en');
    await import('./index');

    expect(page.documentElement.lang).toBe('en');
    expect(page.title).toBe('My Priorities');
    expect(meta['apple-mobile-web-app-title']).toBe('Priorities');
    expect(meta.description).toContain('half an hour');
    expect(manifest.href).toBe(`${BASE}manifest.webmanifest`);
  });

  it('на русском — свои, вместе со своим манифестом', async () => {
    open('?lang=ru');
    await import('./index');

    expect(page.documentElement.lang).toBe('ru');
    expect(page.title).toBe('Мои приоритеты');
    expect(meta['apple-mobile-web-app-title']).toBe('Приоритеты');
    expect(meta.description).toContain('полчаса жизни');
    expect(manifest.href).toBe(`${BASE}manifest.ru.webmanifest`);
  });

  it('переключение языка кнопкой обновляет их тут же', async () => {
    open('?lang=en');
    const { setLocale } = await import('./index');

    setLocale('ru');

    expect(page.documentElement.lang).toBe('ru');
    expect(page.title).toBe('Мои приоритеты');
    expect(meta['apple-mobile-web-app-title']).toBe('Приоритеты');
    expect(manifest.href).toBe(`${BASE}manifest.ru.webmanifest`);
  });
});
