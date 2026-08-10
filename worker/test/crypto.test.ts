import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { base64url, fromBase64url, hmacSha256, sha256, timingSafeEqual, toHex } from '../src/crypto';

describe('обвязка над Web Crypto', () => {
  it('HMAC совпадает с node:crypto', async () => {
    const ours = toHex(await hmacSha256('ключ', 'сообщение'));
    const theirs = createHmac('sha256', 'ключ').update('сообщение').digest('hex');
    expect(ours).toBe(theirs);
  });

  it('SHA-256 совпадает с node:crypto', async () => {
    expect(await sha256('данные')).toBe(createHash('sha256').update('данные').digest('hex'));
  });

  it('base64url переживает круговой прогон и не содержит служебных знаков', () => {
    const source = 'Приоритеты: +/= и прочее ~ 255';
    const encoded = base64url(source);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(new TextDecoder().decode(fromBase64url(encoded))).toBe(source);
  });

  it('base64url разбирает строку любой длины', () => {
    // Хвост без выравнивания — обычное дело: padding при кодировании срезан.
    for (let length = 1; length <= 8; length += 1) {
      const bytes = new Uint8Array(length).fill(200);
      expect([...fromBase64url(base64url(bytes))]).toEqual([...bytes]);
    }
  });

  it('сравнение не зависит от места различия', () => {
    expect(timingSafeEqual('abcdef', 'abcdef')).toBe(true);
    expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
    expect(timingSafeEqual('abcdef', 'zbcdef')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
});
