import { describe, expect, it } from 'vitest';

import { materialize, newShortId, sanitizeSettings } from './settings';
import { MAX_PRIORITIES } from './types';

describe('разбор настроек', () => {
  const raw = (count: number): unknown => ({
    version: 1,
    priorities: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, title: `П${i}`, colorId: 0 })),
    archived: [{ id: 'old', title: 'Старый', colorId: 1 }],
    onboarded: true,
    blockMinutes: 30,
    modules: { skills: true, achievements: true, insights: true },
  });

  it('вытесненные лимитом приоритеты уходят в архив, а не пропадают', () => {
    // Раньше они попадали в общий seen до среза и потому выбрасывались ещё и из
    // архива — исчезали целиком, а их история оставалась без подписи.
    const settings = sanitizeSettings(raw(13))!;
    expect(settings.priorities).toHaveLength(MAX_PRIORITIES);
    const archivedIds = settings.archived.map((p) => p.id);
    expect(archivedIds).toContain('p10');
    expect(archivedIds).toContain('p12');
    expect(archivedIds).toContain('old');
  });

  it('приоритет не может оказаться и активным, и архивным', () => {
    const settings = sanitizeSettings(raw(3))!;
    const active = new Set(settings.priorities.map((p) => p.id));
    expect(settings.archived.every((p) => !active.has(p.id))).toBe(true);
  });

  it('отрицательный индекс цвета приводится к нулю', () => {
    // -1 % 10 === -1, и обращение по такому индексу не даёт цвета вовсе.
    const settings = sanitizeSettings({
      ...(raw(1) as object),
      priorities: [{ id: 'a', title: 'A', colorId: -3 }],
    })!;
    expect(settings.priorities[0]!.colorId).toBe(0);
  });
});

describe('идентификаторы', () => {
  it('не выдаёт занятый id', () => {
    const taken = new Set(['ab', 'cd']);
    for (let i = 0; i < 200; i += 1) expect(taken.has(newShortId(taken))).toBe(false);
  });

  it('короткий, потому что повторяется в каждом дне истории', () => {
    expect(newShortId([])).toHaveLength(2);
  });
});

describe('materialize', () => {
  const known = [
    { id: 'w1', title: 'Работа', colorId: 1 },
    { id: 'f1', title: 'Семья', colorId: 9 },
  ];

  it('переиспользует id по совпадению названия — история не теряется', () => {
    const result = materialize([{ title: 'Работа', colorId: 5 }], known);
    expect(result[0]!.id).toBe('w1');
    // Цвет берётся из набора, а идентичность — из прошлого.
    expect(result[0]!.colorId).toBe(5);
  });

  it('сравнение названий не зависит от регистра и пробелов', () => {
    expect(materialize([{ title: '  работа ', colorId: 0 }], known)[0]!.id).toBe('w1');
  });

  it('новым названиям выдаёт свежие уникальные id', () => {
    const result = materialize(
      [{ title: 'Сон', colorId: 2 }, { title: 'Спорт', colorId: 3 }],
      known,
    );
    const ids = result.map((p) => p.id);
    expect(new Set([...ids, 'w1', 'f1']).size).toBe(4);
  });

  it('обрезает список по лимиту приоритетов', () => {
    const source = Array.from({ length: 15 }, (_, i) => ({ title: `П${i}`, colorId: 0 }));
    expect(materialize(source, [])).toHaveLength(MAX_PRIORITIES);
  });
});
