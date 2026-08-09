/**
 * Кто пришёл.
 *
 * Единственное место, где запрос превращается в пользователя. Правило, которое
 * держится всей архитектурой: `user_id` берётся **только** отсюда, из
 * проверенной подписью claim, и никогда из тела запроса. В D1 нет
 * row-level security, которая подстраховала бы от ошибки, поэтому эта граница
 * — единственное, что отделяет чужие данные от своих.
 */

import type { Env } from './env';
import { unauthorized } from './http';
import { verifyAccess, type AccessClaims } from './jwt';

export interface Caller {
  userId: string;
  deviceId: string;
}

export async function authenticate(request: Request, env: Env): Promise<Caller> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw unauthorized('no-token');

  const claims: AccessClaims | undefined = await verifyAccess(env.JWT_SECRET, token);
  if (!claims) throw unauthorized('bad-token');

  return { userId: claims.sub, deviceId: claims.dev };
}
