/**
 * Сколько часов накоплено в навыке — единственное место, где это считается.
 *
 * Формула аддитивна:
 *   baseMinutes + (carryBlocks + свои блоки + блоки привязанного приоритета) × цена блока
 *
 * Собственные блоки не заменяются блоками привязки, а складываются с ними:
 * навык мог три месяца копить сам и только потом получить привязку, и эти часы
 * не должны молча исчезнуть. Из аддитивности следует главное свойство привязки —
 * она ничего не записывает и полностью обратима: отвязка возвращает ровно то
 * число, что было до неё.
 *
 * baseMinutes живёт в минутах и ценой блока не переоценивается: это факт о
 * прожитой жизни, а не набор кликов. Всё остальное — блоки, и меняется вместе
 * с ценой блока, как и вся остальная история приложения.
 */

import type { ClicksMap, DayKey } from '../domain/types';
import { progressOf, type Progress } from './levels';
import type { Skill } from './types';

export interface SkillContext {
  /** Собственный журнал навыков. */
  skillClicks: ClicksMap;
  /** Журнал приоритетов — из него берут часы привязанные навыки. */
  clicks: ClicksMap;
  blockMinutes: number;
}

function sumFor(clicks: ClicksMap, id: string): number {
  let total = 0;
  for (const entry of Object.values(clicks)) {
    const count = entry[id];
    if (count !== undefined && count > 0) total += count;
  }
  return total;
}

/** Блоки навыка за всю доступную историю, включая свёрнутые месяцы. */
export function skillBlocks(skill: Skill, ctx: SkillContext): number {
  const own = sumFor(ctx.skillClicks, skill.id);
  const linked = skill.linkedPriorityId ? sumFor(ctx.clicks, skill.linkedPriorityId) : 0;
  return skill.carryBlocks + own + linked;
}

export function skillMinutes(skill: Skill, ctx: SkillContext): number {
  return skill.baseMinutes + skillBlocks(skill, ctx) * ctx.blockMinutes;
}

export interface SkillTotal {
  skill: Skill;
  /** Блоки без стартового капитала: он в минутах и к блокам не сводится. */
  blocks: number;
  minutes: number;
  progress: Progress;
}

export function skillTotal(skill: Skill, ctx: SkillContext): SkillTotal {
  const blocks = skillBlocks(skill, ctx);
  const minutes = skill.baseMinutes + blocks * ctx.blockMinutes;
  return { skill, blocks, minutes, progress: progressOf(minutes) };
}

export function skillTotals(skills: Skill[], ctx: SkillContext): SkillTotal[] {
  return skills.map((skill) => skillTotal(skill, ctx));
}

/** Блоки навыка за один день — для строки «сегодня» на экране. */
export function skillBlocksOn(skill: Skill, ctx: SkillContext, day: DayKey): number {
  const own = ctx.skillClicks[day]?.[skill.id] ?? 0;
  const linked = skill.linkedPriorityId ? ctx.clicks[day]?.[skill.linkedPriorityId] ?? 0 : 0;
  return own + linked;
}

/**
 * Блоки за набор дней. Стартовый капитал и свёрнутые месяцы сюда не входят
 * намеренно: у них нет даты, и приписать их к неделе или месяцу нельзя.
 */
export function skillBlocksIn(skill: Skill, ctx: SkillContext, days: DayKey[]): number {
  return days.reduce((sum, day) => sum + skillBlocksOn(skill, ctx, day), 0);
}

/** Те же дни, но по отдельности — история для полосы дней. Порядок сохраняется. */
export function skillBlocksByDay(skill: Skill, ctx: SkillContext, days: DayKey[]): number[] {
  return days.map((day) => skillBlocksOn(skill, ctx, day));
}

export type SkillTarget = { kind: 'priority'; id: string } | { kind: 'skill' };

/**
 * Куда уходит нажатие «+».
 *
 * У навыка с живой привязкой клик идёт приоритету: иначе одно и то же время
 * записалось бы дважды — и в приоритет на главной, и в навык. Если приоритет
 * уехал в архив (удалён или вытеснен набором), дописывать в него нельзя: на
 * главной его нет, а в статистике он бы ожил и показал время из ниоткуда.
 * Тогда новые блоки идут в собственный журнал навыка, а старые часы приоритета
 * продолжают считаться — благодаря аддитивности переключение незаметно.
 */
export function targetOf(skill: Skill, activePriorityIds: Set<string>): SkillTarget {
  if (skill.linkedPriorityId && activePriorityIds.has(skill.linkedPriorityId)) {
    return { kind: 'priority', id: skill.linkedPriorityId };
  }
  return { kind: 'skill' };
}

/** Сумма по всем навыкам — заголовок экрана и достижение «тысяча в сумме». */
export function totalMinutes(totals: SkillTotal[]): number {
  return totals.reduce((sum, item) => sum + item.minutes, 0);
}
