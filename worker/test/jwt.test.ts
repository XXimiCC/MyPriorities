import { describe, expect, it } from 'vitest';

import { base64url } from '../src/crypto';
import { ACCESS_TTL_SECONDS, signAccess, verifyAccess } from '../src/jwt';

const SECRET = 'ключ-подписи-только-для-теста';
const NOW = Date.UTC(2026, 7, 8, 12, 0, 0);

describe('токен доступа', () => {
  it('переживает круговой прогон', async () => {
    const token = await signAccess(SECRET, 'u-1', 'ab12cd34', NOW);
    const claims = await verifyAccess(SECRET, token, NOW);
    expect(claims).toMatchObject({ sub: 'u-1', dev: 'ab12cd34' });
  });

  it('чужим ключом не проверяется', async () => {
    const token = await signAccess(SECRET, 'u-1', 'ab12cd34', NOW);
    expect(await verifyAccess('другой ключ', token, NOW)).toBeUndefined();
  });

  it('просроченный не проходит', async () => {
    const token = await signAccess(SECRET, 'u-1', 'ab12cd34', NOW);
    expect(await verifyAccess(SECRET, token, NOW + (ACCESS_TTL_SECONDS + 1) * 1000)).toBeUndefined();
  });

  it('подмена полезной нагрузки не проходит', async () => {
    const token = await signAccess(SECRET, 'u-1', 'ab12cd34', NOW);
    const [header, , signature] = token.split('.') as [string, string, string];
    const forged = base64url(
      JSON.stringify({ sub: 'чужой', dev: 'ab12cd34', iat: 0, exp: 9_999_999_999 }),
    );
    expect(await verifyAccess(SECRET, `${header}.${forged}.${signature}`, NOW)).toBeUndefined();
  });

  it('подмена алгоритма не проходит', async () => {
    /*
     * Классическая дыра: разобрать заголовок и поверить его полю alg. Здесь
     * заголовок сверяется целиком с единственным допустимым, поэтому ни
     * «alg: none», ни смена алгоритма невозможны в принципе.
     */
    const token = await signAccess(SECRET, 'u-1', 'ab12cd34', NOW);
    const [, payload] = token.split('.') as [string, string, string];
    const none = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    expect(await verifyAccess(SECRET, `${none}.${payload}.`, NOW)).toBeUndefined();
  });

  it('мусор вместо токена не роняет проверку', async () => {
    expect(await verifyAccess(SECRET, '', NOW)).toBeUndefined();
    expect(await verifyAccess(SECRET, 'а.б', NOW)).toBeUndefined();
    expect(await verifyAccess(SECRET, 'а.б.в', NOW)).toBeUndefined();
  });
});
