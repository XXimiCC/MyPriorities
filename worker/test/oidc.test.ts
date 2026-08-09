import { generateKeyPairSync, createSign, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyIdToken } from '../src/oidc';

const CLIENT_ID = '8878708076';
const NOW = Date.UTC(2026, 7, 9, 12, 0, 0);

/**
 * Пара ключей на прогон. Проверка подписи не имеет смысла, если подписывать
 * тем же кодом, что и проверяет, — поэтому подписываем через node:crypto, а
 * ключ отдаём так же, как его отдаёт Telegram: в виде JWK.
 */
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
const KID = randomUUID();

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function sign(
  payload: Record<string, unknown>,
  overrides: { alg?: string; kid?: string; key?: typeof privateKey } = {},
): string {
  const header = b64url(JSON.stringify({ alg: overrides.alg ?? 'RS256', kid: overrides.kid ?? KID }));
  const body = b64url(JSON.stringify(payload));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  return `${header}.${body}.${b64url(signer.sign(overrides.key ?? privateKey))}`;
}

function claims(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const seconds = Math.floor(NOW / 1000);
  return {
    iss: 'https://oauth.telegram.org',
    aud: CLIENT_ID,
    sub: '4242',
    iat: seconds - 10,
    exp: seconds + 300,
    ...extra,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ keys: [{ kid: KID, kty: 'RSA', alg: 'RS256', use: 'sig', ...jwk }] }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('проверка id_token', () => {
  it('целый токен проходит', async () => {
    await expect(verifyIdToken(sign(claims({ username: 'andrii' })), CLIENT_ID, NOW)).resolves.toEqual({
      sub: '4242',
      username: 'andrii',
    });
  });

  it('подпись чужим ключом не проходит', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(verifyIdToken(sign(claims(), { key: other }), CLIENT_ID, NOW)).rejects.toThrow(
      'bad-signature',
    );
  });

  it('подмена алгоритма не проходит', async () => {
    /*
     * Две классические дыры разом: «alg: none» и подмена RS256 на HMAC, где
     * ключом становится публичный ключ из JWKS. Обе закрываются тем, что
     * алгоритм сверяется до всего остального.
     */
    await expect(verifyIdToken(sign(claims(), { alg: 'none' }), CLIENT_ID, NOW)).rejects.toThrow(
      'bad-alg',
    );
    await expect(verifyIdToken(sign(claims(), { alg: 'HS256' }), CLIENT_ID, NOW)).rejects.toThrow(
      'bad-alg',
    );
  });

  it('чужой издатель не проходит', async () => {
    const forged = sign(claims({ iss: 'https://evil.example' }));
    await expect(verifyIdToken(forged, CLIENT_ID, NOW)).rejects.toThrow('bad-issuer');
  });

  it('токен, выданный другому приложению, не проходит', async () => {
    // Без этой проверки годился бы любой токен Telegram — в том числе выданный
    // чужому боту, которому человек вошёл совсем по другому поводу.
    await expect(verifyIdToken(sign(claims({ aud: '999' })), CLIENT_ID, NOW)).rejects.toThrow(
      'bad-audience',
    );
  });

  it('список адресатов допустим, если мы в нём есть', async () => {
    const many = sign(claims({ aud: ['999', CLIENT_ID] }));
    await expect(verifyIdToken(many, CLIENT_ID, NOW)).resolves.toMatchObject({ sub: '4242' });
  });

  it('просроченный не проходит, но небольшой сдвиг часов прощается', async () => {
    const seconds = Math.floor(NOW / 1000);
    await expect(
      verifyIdToken(sign(claims({ exp: seconds - 3600 })), CLIENT_ID, NOW),
    ).rejects.toThrow('expired');
    // Минуту назад истёк — принимаем: у людей часы неточные.
    await expect(
      verifyIdToken(sign(claims({ exp: seconds - 60 })), CLIENT_ID, NOW),
    ).resolves.toMatchObject({ sub: '4242' });
  });

  it('выданный из будущего не проходит', async () => {
    const seconds = Math.floor(NOW / 1000);
    await expect(
      verifyIdToken(sign(claims({ iat: seconds + 3600 })), CLIENT_ID, NOW),
    ).rejects.toThrow('from-future');
  });

  it('незнакомый ключ заставляет перечитать JWKS, не дожидаясь срока кэша', async () => {
    /*
     * Иначе смена ключа у Telegram ломала бы вход на целый час. Кэш здесь уже
     * прогрет предыдущими проверками, поэтому считаем походы «сверх», а не с
     * нуля: абсолютное число зависело бы от порядка тестов.
     */
    const calls = (): number =>
      (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

    await expect(verifyIdToken(sign(claims()), CLIENT_ID, NOW)).resolves.toMatchObject({
      sub: '4242',
    });
    const before = calls();

    await expect(
      verifyIdToken(sign(claims(), { kid: randomUUID() }), CLIENT_ID, NOW),
    ).rejects.toThrow('unknown-key');
    expect(calls()).toBe(before + 1);
  });

  it('мусор вместо токена не роняет проверку', async () => {
    await expect(verifyIdToken('', CLIENT_ID, NOW)).rejects.toThrow('malformed');
    await expect(verifyIdToken('a.b', CLIENT_ID, NOW)).rejects.toThrow('malformed');
    await expect(verifyIdToken('a.b.c', CLIENT_ID, NOW)).rejects.toThrow('malformed');
  });
});
