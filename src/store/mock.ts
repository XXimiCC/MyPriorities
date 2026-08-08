/**
 * Демо-данные для режима `?mock=1`.
 *
 * Без них проверить арифметику окон в 7 и 30 дней можно только реально прождав
 * месяц. Данные живут строго в памяти: флаш при включённом моке отключён, чтобы
 * синтетика не уехала в облако к настоящей истории.
 */

import { addDays, dayKey } from '../domain/date';
import { BASIC_PRESET_ID } from '../domain/presets';
import type { BatteryLevel, BatteryShift, ClicksMap, Journal, Settings } from '../domain/types';
import type { SkillsState } from '../skills/types';
import { defaultSettings } from '../domain/settings';
import type { AwardMap } from '../achievements/types';

export const MOCK_MODE = new URLSearchParams(window.location.search).has('mock');

/** Детерминированный генератор: один и тот же прогон даёт одну и ту же картинку. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function buildMockData(now: Date = new Date()): {
  settings: Settings;
  journal: Journal;
  skills: SkillsState;
  skillClicks: ClicksMap;
  awards: AwardMap;
} {
  const settings = defaultSettings();
  settings.onboarded = true;
  settings.presetId = BASIC_PRESET_ID;

  const random = makeRandom(20260731);
  const journal: Journal = { clicks: {}, battery: {} };

  // Веса задают заметный перекос: работа съедает почти всё, отдых идёт следом —
  // ровно тот сюжет, ради которого приложение и строится.
  const weights = [0.95, 0.5, 0.45, 0.3, 0.2, 0.25, 0.7];

  for (let back = 44; back >= 0; back -= 1) {
    const day = dayKey(addDays(now, -back));

    // Пара пропущенных дней — чтобы серия и «активные дни» не были константой.
    if (random() < 0.12) continue;

    const entry: Record<string, number> = {};
    settings.priorities.forEach((priority, index) => {
      const weight = weights[index] ?? 0.3;
      if (random() > weight) return;
      const blocks = 1 + Math.floor(random() * (weight > 0.8 ? 8 : 4));
      entry[priority.id] = blocks;
    });
    if (Object.keys(entry).length > 0) journal.clicks[day] = entry;

    const shifts: BatteryShift[] = [];
    let minute = 30 + Math.floor(random() * 240);
    let level: BatteryLevel = (1 + Math.floor(random() * 3)) as BatteryLevel;
    while (minute < 1380) {
      shifts.push([minute, level]);
      minute += 120 + Math.floor(random() * 360);
      const roll = random();
      level = roll < 0.12 ? 4 : ((1 + Math.floor(random() * 3)) as BatteryLevel);
    }
    if (shifts.length > 0) journal.battery[day] = shifts;
  }

  /*
   * Навыки подобраны так, чтобы на экране были видны все состояния лестницы:
   * привязанный к приоритету, самостоятельный с большим стартовым капиталом и
   * едва начатый. Первый приоритет набора — «Работа», к нему и привязываемся.
   */
  const workId = settings.priorities[0]?.id;
  const skills: SkillsState = {
    skills: [
      {
        id: 'g1',
        title: 'Гитара',
        colorId: 3,
        baseMinutes: 1640 * 60,
        carryBlocks: 0,
        startedOn: '2014-06-01',
      },
      {
        id: 'g2',
        title: 'Программирование',
        colorId: 1,
        baseMinutes: 4800 * 60,
        carryBlocks: 0,
        ...(workId ? { linkedPriorityId: workId } : {}),
      },
      { id: 'g3', title: 'Английский', colorId: 8, baseMinutes: 12 * 60, carryBlocks: 0 },
    ],
    archived: [],
  };

  const skillClicks: ClicksMap = {};
  for (let back = 20; back >= 0; back -= 1) {
    if (random() < 0.4) continue;
    const day = dayKey(addDays(now, -back));
    const entry: Record<string, number> = { g1: 1 + Math.floor(random() * 3) };
    if (random() < 0.5) entry.g3 = 1;
    skillClicks[day] = entry;
  }

  // Достижения оставляем на автоматическую выдачу — она отработает на этих же
  // данных. Руками отмечаем только то, что из журнала не выводится.
  const awards: AwardMap = { m1: dayKey(addDays(now, -120)), r1: dayKey(addDays(now, -30)) };

  return { settings, journal, skills, skillClicks, awards };
}
