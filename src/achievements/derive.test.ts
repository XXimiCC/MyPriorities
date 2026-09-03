import { describe, expect, it } from 'vitest';

import { DEFAULT_MODULES, type Journal, type Settings } from '../domain/types';
import { derive } from './derive';

const NOW = new Date(2026, 6, 31, 12, 0);

const settings: Settings = {
  version: 1,
  priorities: [{ id: 'ab', title: 'Работа', colorId: 1 }],
  archived: [],
  onboarded: true,
  blockMinutes: 30,
  modules: { ...DEFAULT_MODULES },
};

/** Журнал с одним переходом заряда в заданную минуту каждого из дней. */
function batteryAt(minute: number, days: string[]): Journal {
  const battery: Journal['battery'] = {};
  for (const day of days) battery[day] = [[minute, 1]];
  return { clicks: {}, marks: {}, battery };
}

const FIVE_DAYS = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24'];

describe('окна «жаворонка» и «совы»', () => {
  it('ночная отметка не засчитывается как ранняя', () => {
    // Ночное окно лежало внутри раннего целиком, поэтому «Сова» не могла быть
    // получена раньше «Жаворонка» ни при каком поведении.
    const derived = derive(settings, batteryAt(3 * 60, FIVE_DAYS), NOW);
    expect(derived.nightDays).toBe(5);
    expect(derived.earlyDays).toBe(0);
  });

  it('утренняя отметка не засчитывается как ночная', () => {
    const derived = derive(settings, batteryAt(6 * 60, FIVE_DAYS), NOW);
    expect(derived.earlyDays).toBe(5);
    expect(derived.nightDays).toBe(0);
  });

  it('граница пяти утра принадлежит утру', () => {
    const derived = derive(settings, batteryAt(5 * 60, FIVE_DAYS), NOW);
    expect(derived.earlyDays).toBe(5);
    expect(derived.nightDays).toBe(0);
  });

  it('семь утра и позже не считаются ранним подъёмом', () => {
    const derived = derive(settings, batteryAt(7 * 60, FIVE_DAYS), NOW);
    expect(derived.earlyDays).toBe(0);
    expect(derived.nightDays).toBe(0);
  });

  it('полночь не попадает ни в одно окно', () => {
    // Ночь начинается с часу: отметка ровно в полночь чаще означает не бодрствование,
    // а перенос состояния через сутки.
    const derived = derive(settings, batteryAt(0, FIVE_DAYS), NOW);
    expect(derived.earlyDays).toBe(0);
    expect(derived.nightDays).toBe(0);
  });
});
