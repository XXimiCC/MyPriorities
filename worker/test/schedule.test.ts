/**
 * Развилка по расписанию.
 *
 * Обработчик `scheduled` один на оба триггера, и различает он их по строке
 * `event.cron` — сравнением с константой. Такое сравнение ломается молча: строка
 * в wrangler.toml правится, константа остаётся, напоминание просто перестаёт
 * приходить, и узнать об этом можно только не дождавшись его. Поэтому здесь
 * проверяется и сама развилка, и совпадение констант с конфигом.
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../src/env';
import { NIGHTLY_CRON, REMINDER_CRON, REMINDER_TEXT, jobFor, sendReminder } from '../src/schedule';

function env(extra: Partial<Env> = {}): Env {
  return { TELEGRAM_BOT_TOKEN: '123456:AAHtesttokenvalue', ...extra } as Env;
}

/** Разбор ответа на вызов fetch: чат и текст, ушедшие в Telegram. */
function sentBody(call: unknown[]): { chat_id: string; text: string } {
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('какое дело стоит за расписанием', () => {
  it('вечерний триггер — напоминание, ночной — уборка', () => {
    expect(jobFor(REMINDER_CRON)).toBe('reminder');
    expect(jobFor(NIGHTLY_CRON)).toBe('nightly');
  });

  it('незнакомое и пустое расписание идут в уборку', () => {
    // `wrangler dev --test-scheduled` без параметра cron присылает пустую строку.
    expect(jobFor('')).toBe('nightly');
    expect(jobFor('*/5 * * * *')).toBe('nightly');
  });

  it('обе строки заведены в wrangler.toml дословно', () => {
    const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    expect(config).toContain(`crons = ["${NIGHTLY_CRON}", "${REMINDER_CRON}"]`);
  });
});

describe('отправка напоминания', () => {
  it('шлёт один раз, тем же текстом и в чат отчёта', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);

    await sendReminder(env({ REPORT_CHAT_ID: '246112464' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = sentBody(fetchMock.mock.calls[0] as unknown as unknown[]);
    expect(body.chat_id).toBe('246112464');
    expect(body.text).toBe('Не забыл отметить приоритеты, над которыми работал?');
    expect(body.text).toBe(REMINDER_TEXT);
  });

  it('без адресата молчит, а не падает', async () => {
    // Так же ведёт себя ночной отчёт: локально слать некуда и незачем.
    const fetchMock = vi.fn(async () => new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendReminder(env())).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('отказ доставки ничего не роняет', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('сеть недоступна');
      }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(sendReminder(env({ REPORT_CHAT_ID: '246112464' }))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
