/**
 * Текст условия достижения.
 *
 * Шаблоны общие для похожих достижений — «{n} {nUnit} подряд без пропусков»
 * обслуживает все семь серий сразу. Числа приходят из реестра, а формы слов
 * подставляются здесь: в реестре их держать нельзя, он не знает про язык.
 */

import { plural, t, type PluralKey, type Params, type StringKey } from '../i18n';
import type { Achievement } from './types';

/**
 * Какие числовые подстановки шаблона склоняются и по какому слову.
 * Таблица привязана к шаблону, а не к достижению: у всех «серий» она одна.
 */
const NOTE_UNITS: Partial<Record<StringKey, Record<string, PluralKey>>> = {
  'ach.n.dayBlocks': { n: 'block' },
  'ach.n.activeDays': { n: 'day' },
  'ach.n.span': { n: 'day' },
  'ach.n.hours': { n: 'hour' },
  'ach.n.streak': { n: 'day' },
  'ach.n.evenDays': { n: 'day', min: 'block' },
  'ach.n.oneRow': { n: 'block' },
  'ach.n.everyPriority': { days: 'day', n: 'block' },
  'ach.n.wideWeek': { n: 'priority' },
  'ach.n.batteryDays': { n: 'day' },
  'ach.n.fullCharge': { n: 'day' },
  'ach.n.batteryLow': { n: 'times' },
  'ach.n.drain': { n: 'times' },
  'ach.n.batteryEarly': { n: 'day' },
  'ach.n.batteryNight': { n: 'day' },
  'ach.n.skillCount': { n: 'skill' },
  'ach.n.skillHours': { n: 'hour' },
  'ach.n.skillRank': { n: 'skill' },
  'ach.n.skillSum': { n: 'hour' },
  'ach.n.skillAge': { n: 'year' },
};

export function noteOf(item: Achievement): string {
  const params: Params = { ...item.noteParams };
  const units = NOTE_UNITS[item.noteKey];

  if (units) {
    for (const [name, key] of Object.entries(units)) {
      const value = params[name];
      // Форма кладётся в «имяUnit»: шаблон пишется как «{n} {nUnit}».
      if (typeof value === 'number') params[`${name}Unit`] = plural(key, value);
    }
  }
  return t(item.noteKey, params);
}

export function titleOf(item: Achievement): string {
  return t(item.titleKey);
}
