import { describe, expect, it } from 'vitest';

import { MAX_ARCHIVED_SKILLS, MAX_SKILLS, sanitizeSkills, type Skill } from './types';

const plain = (id: string, patch: Partial<Skill> = {}): Skill => ({
  id,
  title: `Навык ${id}`,
  colorId: 0,
  baseMinutes: 0,
  carryBlocks: 0,
  ...patch,
});

describe('каталог навыков', () => {
  it('читаемая форма проходит без изменений', () => {
    // Компактные однобуквенные поля — приём хранилища, а не формат домена:
    // копию данных человек открывает и читает глазами.
    const state = { skills: [plain('g1', { title: 'Гитара' })], archived: [] };
    expect(sanitizeSkills(state)).toEqual(state);
  });

  it('один приоритет не может кормить два навыка', () => {
    // Иначе одни и те же часы засчитались бы дважды.
    const state = sanitizeSkills({
      skills: [plain('g1', { linkedPriorityId: 'ab' }), plain('g2', { linkedPriorityId: 'ab' })],
      archived: [],
    });
    expect(state.skills[0]!.linkedPriorityId).toBe('ab');
    expect(state.skills[1]!.linkedPriorityId).toBeUndefined();
  });

  it('дубли по id отбрасываются', () => {
    const state = sanitizeSkills({ skills: [plain('g1'), plain('g1')], archived: [] });
    expect(state.skills).toHaveLength(1);
  });

  it('навык не может быть одновременно активным и архивным', () => {
    const state = sanitizeSkills({ skills: [plain('g1')], archived: [plain('g1')] });
    expect(state.skills).toHaveLength(1);
    expect(state.archived).toHaveLength(0);
  });

  it('режет список по потолкам', () => {
    // Длина входа считается от самих потолков: они перестали быть свойством
    // хранилища и теперь свободно меняются, а тест обязан пережить их правку.
    const many = Math.max(MAX_SKILLS, MAX_ARCHIVED_SKILLS) + 5;
    const state = sanitizeSkills({
      skills: Array.from({ length: many }, (_, i) => plain(`s${i}`)),
      archived: Array.from({ length: many }, (_, i) => plain(`a${i}`)),
    });
    expect(state.skills).toHaveLength(MAX_SKILLS);
    expect(state.archived).toHaveLength(MAX_ARCHIVED_SKILLS);
  });

  it('у архивных навыков привязка снимается — они ничего не считают', () => {
    const state = sanitizeSkills({ skills: [], archived: [plain('x1', { linkedPriorityId: 'ab' })] });
    expect(state.archived[0]!.linkedPriorityId).toBeUndefined();
  });

  it('пустое и битое читается как пустой каталог, а не падает', () => {
    expect(sanitizeSkills(undefined)).toEqual({ skills: [], archived: [] });
    expect(sanitizeSkills('строка')).toEqual({ skills: [], archived: [] });
    expect(sanitizeSkills({ skills: 'не массив', archived: null })).toEqual({
      skills: [],
      archived: [],
    });
  });
});
