/**
 * Идентификатор устройства.
 *
 * Нужен для двух вещей сразу: разрешать ничью в метке времени и давать серверу
 * барьер компакции — свернуть операции можно только до того места, которое
 * забрали все живые устройства.
 *
 * Ничего личного в нём нет: это случайные восемь символов, не связанные ни с
 * аккаунтом, ни с железом. Одно и то же устройство после сброса хранилища
 * станет для сервера новым, и это правильно — курсор синхронизации у него
 * действительно начинается заново.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DEVICE_ID_LENGTH = 8;

/**
 * Случайные байты. `crypto` есть и в браузере, и в вебвью, и в node начиная с
 * 19-го, но встречаются сборки без него — там довольствуемся `Math.random`:
 * столкновение восьмисимвольных идентификаторов у одного человека куда менее
 * вероятно, чем то, что мы вовсе не сможем его выдать.
 */
function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const source = typeof crypto !== 'undefined' ? crypto : undefined;
  if (source?.getRandomValues) {
    source.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < length; i += 1) out[i] = Math.floor(Math.random() * 256);
  return out;
}

export function newDeviceId(): string {
  const bytes = randomBytes(DEVICE_ID_LENGTH);
  let id = '';
  for (let i = 0; i < DEVICE_ID_LENGTH; i += 1) {
    id += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return id;
}

const DEVICE_ID_PATTERN = /^[a-z0-9]{1,32}$/;

/**
 * Проверка формы. Алфавит здесь не косметика: метка времени склеивается через
 * двоеточие, и идентификатор с двоеточием внутри сломал бы её разбор.
 */
export function isDeviceId(raw: unknown): raw is string {
  return typeof raw === 'string' && DEVICE_ID_PATTERN.test(raw);
}

const META_KEY = 'deviceId';

/**
 * Идентификатор этого устройства: один на всё приложение.
 *
 * Живёт здесь, а не там, где понадобился первым, потому что нужен сразу двоим —
 * часам журнала и авторизации, — и разойтись они не должны: сервер считает
 * устройства по нему, и два разных означали бы два устройства вместо одного.
 */
let resolved: Promise<string> | undefined;

export function deviceId(): Promise<string> {
  resolved ??= (async () => {
    // Импорт внутри, а не сверху: без него этот модуль остаётся чистым и
    // проверяется без поднятия базы.
    const { opsLog } = await import('../store/local/db');
    const stored = await opsLog.meta(META_KEY);
    if (isDeviceId(stored)) return stored;

    const fresh = newDeviceId();
    await opsLog.setMeta(META_KEY, fresh);
    return fresh;
  })().catch((error) => {
    // Хранилище не отдало — работаем с временным. Синхронизация от этого
    // страдает, запись данных нет.
    console.warn('[sync] идентификатор устройства не сохранился', error);
    return newDeviceId();
  });
  return resolved;
}

/** Только для тестов: следующий вызов снова спросит хранилище. */
export function resetDeviceIdForTests(): void {
  resolved = undefined;
}
