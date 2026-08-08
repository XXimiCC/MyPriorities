import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { localStore, resetBackendForTests } from './db';

/**
 * Минимальный `localStorage` для node: нужны только те пять членов, которыми
 * пользуется хранилище, а не весь интерфейс Storage.
 */
class MemoryStorage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

const MIGRATED_MARK = 'mypri/__idb';

function useWebStorage(): MemoryStorage {
  const stub = new MemoryStorage();
  globalThis.localStorage = stub as unknown as Storage;
  return stub;
}

function dropWebStorage(): void {
  Reflect.deleteProperty(globalThis, 'localStorage');
}

function dropIndexedDb(): void {
  Reflect.deleteProperty(globalThis, 'indexedDB');
}

/** Прямая запись в базу мимо `localStore` — нужна, чтобы собрать состояние «перенос не доехал». */
function seedDatabase(entries: Array<[string, string]>): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mypri', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('kv');
      request.result.createObjectStore('meta');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('kv', 'readwrite');
      for (const [key, value] of entries) tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

beforeEach(() => {
  // Своя фабрика на каждый тест: базы fake-indexeddb иначе переживают тест.
  globalThis.indexedDB = new IDBFactory();
  useWebStorage();
  resetBackendForTests();
});

afterEach(() => {
  dropWebStorage();
  resetBackendForTests();
});

describe('локальная копия на IndexedDB', () => {
  it('пишет, читает, перечисляет и удаляет', async () => {
    await localStore.set('mp:s', '{"version":1}');
    await localStore.set('mp:p:2026-08', '{"01":{"ab":2}}');

    expect(await localStore.get(['mp:s', 'mp:p:2026-08'])).toEqual({
      'mp:s': '{"version":1}',
      'mp:p:2026-08': '{"01":{"ab":2}}',
    });
    expect((await localStore.keys()).sort()).toEqual(['mp:p:2026-08', 'mp:s']);

    await localStore.remove(['mp:s']);
    expect(await localStore.get(['mp:s'])).toEqual({});
  });

  it('отсутствующий ключ не попадает в ответ', async () => {
    await localStore.set('mp:s', '{}');
    expect(await localStore.get(['mp:s', 'mp:a'])).toEqual({ 'mp:s': '{}' });
  });

  it('getPair отдаёт значение как локальную копию', async () => {
    await localStore.set('mp:a', '{"v":1}');
    expect(await localStore.getPair(['mp:a'])).toEqual({ 'mp:a': { local: '{"v":1}' } });
  });
});

describe('перенос старой копии', () => {
  it('забирает ключи из localStorage и не стирает их', async () => {
    const web = useWebStorage();
    web.setItem('mypri/mp:s', '{"version":1}');
    web.setItem('mypri/mp:p:2026-07', '{"03":{"ab":1}}');
    web.setItem('чужой-ключ', 'не наш');
    resetBackendForTests();

    expect(await localStore.get(['mp:s', 'mp:p:2026-07'])).toEqual({
      'mp:s': '{"version":1}',
      'mp:p:2026-07': '{"03":{"ab":1}}',
    });

    // Откат на прежнюю сборку не должен оставить человека вовсе без данных.
    expect(web.getItem('mypri/mp:s')).toBe('{"version":1}');
    expect(await localStore.keys()).not.toContain('чужой-ключ');
  });

  it('не затирает то, что уже лежит в базе', async () => {
    await seedDatabase([['mp:s', 'новое']]);
    const web = useWebStorage();
    web.setItem('mypri/mp:s', 'старое');
    resetBackendForTests();

    expect(await localStore.get(['mp:s'])).toEqual({ 'mp:s': 'новое' });
  });

  it('служебная отметка не попадает в список ключей', async () => {
    const web = useWebStorage();
    web.setItem('mypri/mp:s', '{}');
    resetBackendForTests();

    await localStore.get(['mp:s']);
    expect(web.getItem(MIGRATED_MARK)).toBe('1');
    expect(await localStore.keys()).toEqual(['mp:s']);
  });
});

describe('когда базы нет', () => {
  it('данные уже переехали, а база не открылась — чтение отказывает', async () => {
    const web = useWebStorage();
    // Копия времён до переезда: устаревшая, но внешне валидная.
    web.setItem('mypri/mp:s', '{"version":1,"priorities":[]}');
    web.setItem(MIGRATED_MARK, '1');
    dropIndexedDb();
    resetBackendForTests();

    // Отдать эту копию значило бы показать пустой кабинет и записать его
    // поверх настоящего — ровно то, от чего бережётся loadFailed.
    await expect(localStore.get(['mp:s'])).rejects.toThrow(/IndexedDB недоступен/);
    await expect(localStore.keys()).rejects.toThrow(/IndexedDB недоступен/);
  });

  it('переезда ещё не было — остаёмся на localStorage', async () => {
    const web = useWebStorage();
    web.setItem('mypri/mp:s', '{"version":1}');
    dropIndexedDb();
    resetBackendForTests();

    expect(await localStore.get(['mp:s'])).toEqual({ 'mp:s': '{"version":1}' });
    await localStore.set('mp:a', '{"v":1}');
    expect(web.getItem('mypri/mp:a')).toBe('{"v":1}');
  });

  it('постоянного хранилища нет вовсе — работаем из памяти', async () => {
    dropIndexedDb();
    dropWebStorage();
    resetBackendForTests();

    await localStore.set('mp:s', '{"version":1}');
    expect(await localStore.get(['mp:s'])).toEqual({ 'mp:s': '{"version":1}' });
  });
});
