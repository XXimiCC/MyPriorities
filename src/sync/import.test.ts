/**
 * Разовый перенос из прежнего хранилища в журнал.
 *
 * Точка невозврата: после отметки прежнее хранилище не читается больше никогда.
 * Поэтому тесты здесь не про «работает ли», а про «когда нельзя»: не сошлось,
 * не прочиталось, уже перенесено.
 */

import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { opsLog, resetBackendForTests } from '../store/local/db';
import { backupBeforeSync } from './adopt';
import { formatStamp } from './hlc';
import { importLegacyOnce } from './import';
import { isMigrated, readLocalDocs } from './local';
import type { Stamper } from './ops';
import { emptyBase, project } from './project';

vi.mock('../store/legacy/persistence', () => ({
  allStoredMonths: vi.fn(),
  loadSettings: vi.fn(),
  loadSkills: vi.fn(),
  loadAwards: vi.fn(),
  loadJournal: vi.fn(),
  loadSkillClicks: vi.fn(),
}));

const legacy = await import('../store/legacy/persistence');

function stamper(): Stamper {
  let wall = 1_770_000_000_000;
  return () => {
    wall += 1;
    return formatStamp({ wall, counter: 0 }, 'device01');
  };
}

/** Прежнее хранилище с историей за два года — глубже прежнего горизонта. */
function withHistory(): void {
  vi.mocked(legacy.allStoredMonths).mockResolvedValue(['2024-03', '2026-08']);
  vi.mocked(legacy.loadSettings).mockResolvedValue({
    version: 1,
    priorities: [{ id: 'ia', title: 'Работа', colorId: 1 }],
    archived: [],
    onboarded: true,
    blockMinutes: 30,
    modules: { skills: true, achievements: true, insights: true },
  });
  vi.mocked(legacy.loadSkills).mockResolvedValue({ skills: [], archived: [] });
  vi.mocked(legacy.loadAwards).mockResolvedValue({ n1: '2024-03-04' });
  vi.mocked(legacy.loadJournal).mockResolvedValue({
    clicks: { '2024-03-04': { ia: 4 }, '2026-08-09': { ia: 6 } },
    battery: { '2026-08-09': [[540, 3]] },
  });
  vi.mocked(legacy.loadSkillClicks).mockResolvedValue({ '2026-08-09': { sk: 2 } });
}

function empty(): void {
  vi.mocked(legacy.allStoredMonths).mockResolvedValue([]);
  vi.mocked(legacy.loadSettings).mockResolvedValue(undefined);
  vi.mocked(legacy.loadSkills).mockResolvedValue({ skills: [], archived: [] });
  vi.mocked(legacy.loadAwards).mockResolvedValue({});
  vi.mocked(legacy.loadJournal).mockResolvedValue({ clicks: {}, battery: {} });
  vi.mocked(legacy.loadSkillClicks).mockResolvedValue({});
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetBackendForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  resetBackendForTests();
});

describe('перенос прежнего хранилища', () => {
  it('переносит историю целиком, включая месяцы глубже прежнего горизонта', async () => {
    withHistory();
    const done = await importLegacyOnce(stamper());
    expect(done).toBeDefined();

    const projected = project(emptyBase(), await opsLog.all());
    expect(projected.journal.clicks['2024-03-04']).toEqual({ ia: 4 });
    expect(projected.journal.clicks['2026-08-09']).toEqual({ ia: 6 });
    expect(projected.skillClicks['2026-08-09']).toEqual({ sk: 2 });
    expect(projected.journal.battery['2026-08-09']).toEqual([[540, 3]]);
    expect(projected.awards).toEqual({ n1: '2024-03-04' });

    const docs = await readLocalDocs();
    expect(docs.settings?.priorities).toHaveLength(1);
    expect(await isMigrated()).toBe(true);
  });

  it('перенесённое не уходит на сервер напрямую', async () => {
    /*
     * Это абсолютные установки по каждой ячейке. Попав на сервер, где уже есть
     * история другого устройства, они бы её перебили. Своё туда попадёт
     * доливкой, которая сравнивает и отдаёт только недостающее.
     */
    withHistory();
    await importLegacyOnce(stamper());

    expect((await opsLog.all()).length).toBeGreaterThan(0);
    expect(await opsLog.pending()).toHaveLength(0);
  });

  it('делается один раз', async () => {
    withHistory();
    await importLegacyOnce(stamper());
    const after = (await opsLog.all()).length;

    expect(await importLegacyOnce(stamper())).toBeUndefined();
    expect(await opsLog.all()).toHaveLength(after);
  });

  it('копия снимается до отметки о переносе', async () => {
    withHistory();
    await importLegacyOnce(stamper());
    expect(await backupBeforeSync()).toBeDefined();
  });

  it('недоступное хранилище не считается пустым', async () => {
    /*
     * Самое опасное место всего переноса. Пустая память здесь означает «не
     * отдали», а не «ничего нет»: отметив такое перенесённым, мы навсегда
     * закрыли бы чтение настоящих данных.
     */
    withHistory();
    vi.mocked(legacy.loadJournal).mockRejectedValue(new Error('IndexedDB недоступна'));

    expect(await importLegacyOnce(stamper())).toBeUndefined();
    expect(await isMigrated()).toBe(false);
    expect(await opsLog.all()).toHaveLength(0);
  });

  it('новое устройство отмечается перенесённым сразу', async () => {
    // Иначе прежнее хранилище перечитывалось бы при каждом запуске впустую.
    empty();
    const done = await importLegacyOnce(stamper());
    expect(done?.ops).toBe(0);
    expect(await isMigrated()).toBe(true);
  });

  it('не сошедшийся перенос ничего не отмечает', async () => {
    // Расхождение означает ошибку в правилах. Лучше не переносить вовсе, чем
    // перенести неверно и закрыть дорогу назад.
    withHistory();
    vi.mocked(legacy.loadJournal).mockResolvedValue({
      // Отрицательное число проекция срежет нулём — перенос не сойдётся.
      clicks: { '2026-08-09': { ia: -5 } },
      battery: {},
    });

    expect(await importLegacyOnce(stamper())).toBeUndefined();
    expect(await isMigrated()).toBe(false);
  });
});
