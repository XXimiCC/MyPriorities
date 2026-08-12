import { describe, expect, it } from 'vitest';

import { availability } from './access';

const url = 'https://tickets.example.workers.dev';

describe('когда панель доступна', () => {
  it('без адреса сервера её нет', () => {
    // Иначе человек размечает кадр, а отправить его некуда.
    expect(availability({ endpoint: '', hostname: 'my-app.vercel.app', search: '' })).toBe('off');
  });

  it('на своей машине — видимой кнопкой', () => {
    expect(availability({ endpoint: url, hostname: 'localhost', search: '' })).toBe('always');
    expect(availability({ endpoint: url, hostname: '127.0.0.1', search: '' })).toBe('always');
    expect(availability({ endpoint: url, hostname: '192.168.0.5', search: '' })).toBe('always');
    expect(availability({ endpoint: url, hostname: '172.20.4.1', search: '' })).toBe('always');
    expect(availability({ endpoint: url, hostname: 'macbook.local', search: '' })).toBe('always');
  });

  it('адрес из соседней подсети своим не считается', () => {
    // 172.32 уже за пределами приватного диапазона 172.16–172.31.
    expect(availability({ endpoint: url, hostname: '172.32.4.1', search: '' })).toBe('gesture');
    expect(availability({ endpoint: url, hostname: '109.10.0.1', search: '' })).toBe('gesture');
  });

  it('на боевом адресе — только по жесту', () => {
    expect(availability({ endpoint: url, hostname: 'my-app.vercel.app', search: '' })).toBe('gesture');
  });

  it('явная просьба в адресе показывает кнопку где угодно', () => {
    // Ровно тот случай: телефон открыл dev-сервер через туннель со случайным именем.
    expect(availability({ endpoint: url, hostname: 'wispy-cat.trycloudflare.com', search: '?devkit=1' })).toBe(
      'always',
    );
  });

  it('явный отказ сильнее всего остального', () => {
    // Этим параметром съёмка документации закрывает панель даже на localhost.
    expect(availability({ endpoint: url, hostname: 'localhost', search: '?devkit=0' })).toBe('off');
    expect(availability({ endpoint: url, hostname: 'localhost', search: '?mock=1&devkit=0' })).toBe('off');
  });

  it('в демо на боевом адресе панели нет', () => {
    expect(availability({ endpoint: url, hostname: 'my-app.vercel.app', search: '?demo=f', demo: true })).toBe(
      'off',
    );
  });

  it('просьба самого приложения показывает значок', () => {
    // Клиент Telegram на компьютере: адрес не поправить, пальцев нет,
    // сочетание клавиш может забрать себе клиент. Ссылка работает всегда.
    expect(availability({ endpoint: url, hostname: 'my-app.vercel.app', search: '', asked: true })).toBe('always');
  });

  it('приглашённому тестировщику — видимая кнопка', () => {
    // Объяснять жест тремя пальцами в переписке дороже, чем получить отчёт.
    expect(availability({ endpoint: url, hostname: 'my-app.vercel.app', search: '?test=abc', invite: 'abc' })).toBe(
      'always',
    );
  });

  it('но не в демо: отправить оттуда всё равно нечем', () => {
    expect(
      availability({ endpoint: url, hostname: 'my-app.vercel.app', search: '?test=abc', demo: true, invite: 'abc' }),
    ).toBe('off');
  });

  it('и не там, где панель выключили явно', () => {
    expect(availability({ endpoint: url, hostname: 'my-app.vercel.app', search: '?devkit=0', invite: 'abc' })).toBe(
      'off',
    );
  });

  it('в демо на своей машине панель остаётся', () => {
    // Демо-данные — обычный режим разработки: именно на них смотрят интерфейс.
    expect(availability({ endpoint: url, hostname: 'localhost', search: '?mock=1', demo: true })).toBe('always');
  });
});
