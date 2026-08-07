import { describe, expect, it } from 'vitest';

import { serializeAwards } from '../store/persistence';
import { VALUE_LIMIT } from '../telegram/cloudStorage';
import { t } from '../i18n';
import { noteOf } from './note';
import { ACHIEVEMENTS } from './registry';
import { GROUPS, RETIRED_IDS } from './types';

describe('реестр достижений', () => {
  it('идентификаторы уникальны', () => {
    const ids = ACHIEVEMENTS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('идентификаторы короткие и стабильные по форме', () => {
    // Два символа: карта достижений целиком лежит в одном значении CloudStorage.
    for (const item of ACHIEVEMENTS) {
      expect(item.id).toMatch(/^[a-z0-9]{2}$/);
    }
  });

  it('снятые с реестра идентификаторы никому не достаются повторно', () => {
    const retired = new Set(RETIRED_IDS);
    for (const item of ACHIEVEMENTS) {
      expect(retired.has(item.id)).toBe(false);
    }
  });

  it('у автоматических есть условие, у остальных его нет', () => {
    for (const item of ACHIEVEMENTS) {
      if (item.kind === 'auto') expect(item.test).toBeTypeOf('function');
      else expect(item.test).toBeUndefined();
    }
  });

  it('все группы существуют и все используются', () => {
    const used = new Set(ACHIEVEMENTS.map((item) => item.group));
    for (const group of used) expect(GROUPS).toContain(group);
    for (const group of GROUPS) expect(used.has(group)).toBe(true);
  });

  it('у каждого есть название и внятное условие', () => {
    for (const item of ACHIEVEMENTS) {
      // t возвращает сам ключ, если строки нет, — на это и проверяем.
      expect(t(item.titleKey)).not.toBe(item.titleKey);
      const note = noteOf(item);
      expect(note).not.toBe(item.noteKey);
      // Незаполненная подстановка выдала бы себя фигурными скобками в тексте.
      expect(note).not.toMatch(/[{}]/);
      // А неразрешённый идентификатор — латиницей: в реестре ранг лежит как
      // 'expert', и без резолва он так и печатался в русском тексте условия.
      expect(note).not.toMatch(/[A-Za-z]/);
    }
  });

  it('достижения за навыки помечены зависимостью от модуля', () => {
    for (const item of ACHIEVEMENTS) {
      if (item.group === 'skills') expect(item.needs).toBe('skills');
      else expect(item.needs).toBeUndefined();
    }
  });

  it('весь реестр, выданный разом, укладывается в лимит CloudStorage', () => {
    const awards = Object.fromEntries(ACHIEVEMENTS.map((item) => [item.id, '2026-08-06']));
    expect(serializeAwards(awards).length).toBeLessThan(VALUE_LIMIT);
  });
});
