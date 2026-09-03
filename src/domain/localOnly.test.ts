import { describe, expect, it } from 'vitest';

import { addDays, dayKey } from './date';
import { LOCAL_ONLY_MIN_DAYS, historyAge, historyDays, localOnlyDue } from './localOnly';
import { DEFAULT_MODULES, timelessMarks, type DayKey, type Journal, type Settings } from './types';

const NOW = new Date(2026, 6, 31, 12, 0); // 31 июля 2026, полдень

const settings: Settings = {
  version: 1,
  priorities: [{ id: 'ab', title: 'Работа', colorId: 0 }],
  archived: [],
  onboarded: true,
  blockMinutes: 30,
  modules: DEFAULT_MODULES,
};

function back(days: number): DayKey {
  return dayKey(addDays(NOW, -days));
}

/** Журнал из готовых итогов: возраст истории считается по дням, не по временам. */
function journalOf(clicks: Journal['clicks'], battery: Journal['battery'] = {}): Journal {
  return { clicks, marks: timelessMarks(clicks), battery };
}

/** Журнал с единственной отметкой указанной давности. */
function since(days: number): Journal {
  return journalOf({ [back(days)]: { ab: 1 } });
}

describe('возраст истории', () => {
  it('пустой журнал — ноль дней', () => {
    expect(historyDays(journalOf({}), NOW)).toBe(0);
  });

  it('считает от первой отметки, а не от последней', () => {
    const journal = since(99);
    journal.clicks[back(1)] = { ab: 2 };
    journal.marks[back(1)] = { ab: [null, null] };
    expect(historyDays(journal, NOW)).toBe(100);
  });

  it('отметка заряда — тоже история', () => {
    expect(historyDays(journalOf({}, { [back(40)]: [[600, 2]] }), NOW)).toBe(41);
  });
});

describe('когда говорить про единственное устройство', () => {
  it('молчит, пока истории меньше порога', () => {
    expect(localOnlyDue(settings, LOCAL_ONLY_MIN_DAYS, false)).toBe(false);
  });

  it('говорит, когда порог пройден и ни входа, ни копии не было', () => {
    expect(localOnlyDue(settings, LOCAL_ONLY_MIN_DAYS + 1, false)).toBe(true);
  });

  it('вошедшему не говорит вовсе', () => {
    expect(localOnlyDue(settings, 400, true)).toBe(false);
  });

  it('снявшему копию не говорит вовсе', () => {
    expect(localOnlyDue({ ...settings, exported: true }, 400, false)).toBe(false);
  });

  it('закрытая строка не возвращается', () => {
    expect(localOnlyDue({ ...settings, localOnlySeen: true }, 400, false)).toBe(false);
  });
});

describe('срок словами', () => {
  it('месяц с небольшим — один месяц, а не два', () => {
    // Округление вниз: «два месяца» на сорок пятый день было бы преувеличением
    // ровно там, где приложение говорит о потере данных.
    expect(historyAge(45)).toBe('1 месяц');
  });

  it('укрупняется до лет', () => {
    expect(historyAge(120)).toBe('4 месяца');
    expect(historyAge(400)).toBe('1 год');
    expect(historyAge(800)).toBe('2 года');
  });
});
