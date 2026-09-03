/**
 * Разбор входа в демо.
 *
 * Тот же `startapp`, что несёт метку источника (`sync/source.ts`), несёт и
 * приглашение посмотреть чужую жизнь. Два смысла в одном параметре — ровно то
 * место, где легко сломать один, починив другой, поэтому оба разбора проверяются
 * рядом.
 */

import { describe, expect, it } from 'vitest';

import { resolveEntry } from './mode';

describe('вход в демо', () => {
  it('ссылка-приглашение открывает профиль гостем', () => {
    expect(resolveEntry('', 'demo_max')).toEqual({ id: 'max', guest: true });
    expect(resolveEntry('', 'demo_burnout')).toEqual({ id: 'burnout', guest: true });
  });

  it('метка источника демо не включает', () => {
    // Иначе `startapp=from_habr` открыл бы приложение чужой историей.
    expect(resolveEntry('', 'from_habr')).toBeUndefined();
    expect(resolveEntry('', 'from_max')).toBeUndefined();
  });

  it('несуществующий профиль не открывает ничего', () => {
    expect(resolveEntry('', 'demo_выдумка')).toBeUndefined();
  });

  it('адресная строка работает как раньше', () => {
    expect(resolveEntry('?demo=f', undefined)).toEqual({ id: 'f', guest: true });
    // Съёмка: данные демонстрационные, интерфейс полный.
    expect(resolveEntry('?mock=1', undefined)).toEqual({ id: 'm', guest: false });
    expect(resolveEntry('?mock=max', undefined)).toEqual({ id: 'max', guest: false });
  });

  it('явное «нет» сильнее приглашения', () => {
    // `startapp` переживает перезагрузку, и без этого выход из демо возвращал бы
    // в него же следующим кадром.
    expect(resolveEntry('?demo=off', 'demo_max')).toBeUndefined();
  });
});
