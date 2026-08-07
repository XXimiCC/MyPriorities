/**
 * Реестр достижений.
 *
 * Список декларативный: запись — это условие и две строки, а не код. Добавить
 * достижение значит дописать строку сюда и две строки в ru.ts; ничего больше
 * трогать не нужно. На этом же держится будущая кастомизация — реестр под неё
 * и рассчитан, просто пока он один и зашит.
 *
 * Достижения по навыкам сформулированы глобально («любой навык достиг ста
 * часов»), а не по каждому навыку отдельно: семнадцать ступеней на двенадцать
 * навыков — это двести с лишним записей в хранилище вместо тринадцати.
 */

import { parseDayKey } from '../domain/date';
import { blockMinutesOf } from '../domain/types';
import { atLeastRank, type RankId } from '../skills/levels';
import { MIN_SPREAD_PRIORITIES } from './derive';
import type { Achievement, AchievementContext, AchievementId } from './types';

const HOUR = 60;

type DeedId = Extract<AchievementId, `r${string}`>;
type LifeId = Extract<AchievementId, `m${string}`>;

const auto = (
  id: AchievementId,
  group: Achievement['group'],
  noteKey: Achievement['noteKey'],
  test: NonNullable<Achievement['test']>,
  noteParams?: Achievement['noteParams'],
): Achievement => ({
  id,
  group,
  kind: 'auto',
  titleKey: `ach.${id}`,
  noteKey,
  ...(noteParams ? { noteParams } : {}),
  test,
});

const skillAuto = (
  id: AchievementId,
  noteKey: Achievement['noteKey'],
  test: NonNullable<Achievement['test']>,
  noteParams?: Achievement['noteParams'],
): Achievement => ({ ...auto(id, 'skills', noteKey, test, noteParams), needs: 'skills' });

const deed = (id: DeedId): Achievement => ({
  id,
  group: 'ritual',
  kind: 'deed',
  titleKey: `ach.${id}`,
  noteKey: `ach.n.${id}`,
});

const life = (id: LifeId): Achievement => ({
  id,
  group: 'life',
  kind: 'manual',
  titleKey: `ach.${id}`,
  noteKey: 'ach.n.life',
});

export const ACHIEVEMENTS: readonly Achievement[] = [
  // --- Начало ---
  auto('s1', 'start', 'ach.n.firstClick', (c) => c.derived.totalBlocks > 0),
  auto('s2', 'start', 'ach.n.dayBlocks', (c) => c.derived.maxBlocksInDay >= 4, { n: 4 }),
  auto('s3', 'start', 'ach.n.activeDays', (c) => c.derived.activeDays >= 7, { n: 7 }),
  auto('s4', 'start', 'ach.n.activeDays', (c) => c.derived.activeDays >= 30, { n: 30 }),
  auto('s5', 'start', 'ach.n.activeDays', (c) => c.derived.activeDays >= 100, { n: 100 }),
  auto('s6', 'start', 'ach.n.span', (c) => c.derived.spanDays >= 365, { n: 365 }),

  // --- Часы в приоритетах ---
  // Выше двух с половиной тысяч не идём: горизонт хранения в тринадцать месяцев
  // делает большие числа недостижимыми. Крупные цифры живут в группе навыков,
  // где их вытягивает стартовый капитал.
  auto('h1', 'hours', 'ach.n.hours', (c) => hoursOf(c) >= 10, { n: 10 }),
  auto('h2', 'hours', 'ach.n.hours', (c) => hoursOf(c) >= 50, { n: 50 }),
  auto('h3', 'hours', 'ach.n.hours', (c) => hoursOf(c) >= 100, { n: 100 }),
  auto('h4', 'hours', 'ach.n.hours', (c) => hoursOf(c) >= 250, { n: 250 }),
  auto('h5', 'hours', 'ach.n.hours', (c) => hoursOf(c) >= 500, { n: 500 }),
  auto('h6', 'hours', 'ach.n.hours', (c) => hoursOf(c) >= 1000, { n: 1000 }),
  auto('h7', 'hours', 'ach.n.hours', (c) => hoursOf(c) >= 2500, { n: 2500 }),

  // --- Серии ---
  auto('k1', 'streak', 'ach.n.streak', (c) => c.derived.bestStreak >= 3, { n: 3 }),
  auto('k2', 'streak', 'ach.n.streak', (c) => c.derived.bestStreak >= 7, { n: 7 }),
  auto('k3', 'streak', 'ach.n.streak', (c) => c.derived.bestStreak >= 14, { n: 14 }),
  auto('k4', 'streak', 'ach.n.streak', (c) => c.derived.bestStreak >= 30, { n: 30 }),
  auto('k5', 'streak', 'ach.n.streak', (c) => c.derived.bestStreak >= 60, { n: 60 }),
  auto('k6', 'streak', 'ach.n.streak', (c) => c.derived.bestStreak >= 100, { n: 100 }),
  auto('k7', 'streak', 'ach.n.streak', (c) => c.derived.bestStreak >= 365, { n: 365 }),

  // --- Дисциплина ---
  auto('d1', 'discipline', 'ach.n.evenDays', (c) => c.derived.bestRunMin2 >= 7, { n: 7, min: 2 }),
  auto('d2', 'discipline', 'ach.n.evenDays', (c) => c.derived.bestRunMin4 >= 30, { n: 30, min: 4 }),
  auto('d3', 'discipline', 'ach.n.dayBlocks', (c) => c.derived.maxBlocksInDay >= 10, { n: 10 }),
  auto('d4', 'discipline', 'ach.n.dayBlocks', (c) => c.derived.maxBlocksInDay >= 20, { n: 20 }),
  auto('d5', 'discipline', 'ach.n.oneRow', (c) => c.derived.maxOneRowInDay >= 12, { n: 12 }),
  auto('d6', 'discipline', 'ach.n.fullDay', (c) => c.derived.fullDay),

  // --- Баланс, окно в тридцать дней ---
  auto('b1', 'balance', 'ach.n.everyPriority', (c) => everyActive(c.derived.last30, 1), {
    days: 30,
    n: 1,
  }),
  auto('b2', 'balance', 'ach.n.leaderUnder', (c) => leaderAtMost(c.derived.last30, 5, 0.4), {
    n: 40,
  }),
  auto('b3', 'balance', 'ach.n.leaderUnder', (c) => leaderAtMost(c.derived.last30, 5, 0.3), {
    n: 30,
  }),
  // Честное достижение: перекос — это не провал, это то, что вы наконец увидели.
  auto('b4', 'balance', 'ach.n.leaderOver', (c) => leaderAtLeast(c.derived.last30, 2, 0.7), {
    n: 70,
  }),
  auto('b5', 'balance', 'ach.n.wideWeek', (c) => activeCount(c.derived.last7) >= 7, { n: 7 }),
  auto('b6', 'balance', 'ach.n.everyPriority', (c) => everyActive(c.derived.last7, 2), {
    days: 7,
    n: 2,
  }),

  // --- Заряд ---
  auto('c1', 'charge', 'ach.n.firstShift', (c) => c.derived.batteryShifts > 0),
  auto('c2', 'charge', 'ach.n.batteryDays', (c) => c.derived.batteryDays >= 7, { n: 7 }),
  auto('c3', 'charge', 'ach.n.batteryDays', (c) => c.derived.batteryDays >= 30, { n: 30 }),
  auto('c4', 'charge', 'ach.n.fullCharge', (c) => c.derived.bestFullChargeRun >= 3, { n: 3 }),
  auto('c5', 'charge', 'ach.n.batteryLow', (c) => c.derived.lowCount >= 10, { n: 10 }),
  auto('c6', 'charge', 'ach.n.drain', (c) => c.derived.drainAnswers >= 5, { n: 5 }),
  // Время суток берётся из переходов заряда: у кликов его нет вовсе.
  auto('c7', 'charge', 'ach.n.batteryEarly', (c) => c.derived.earlyDays >= 5, { n: 5 }),
  auto('c8', 'charge', 'ach.n.batteryNight', (c) => c.derived.nightDays >= 5, { n: 5 }),

  // --- Навыки ---
  skillAuto('n1', 'ach.n.skillCount', (c) => c.skills.length >= 1, { n: 1 }),
  skillAuto('n2', 'ach.n.skillCount', (c) => c.skills.length >= 3, { n: 3 }),
  skillAuto('n3', 'ach.n.skillCount', (c) => c.skills.length >= 5, { n: 5 }),
  skillAuto('n4', 'ach.n.skillStarted', (c) =>
    c.skills.some((s) => s.progress.level.rank !== 'none'),
  ),
  skillAuto('n5', 'ach.n.skillHours', (c) => topSkillMinutes(c) >= 100 * HOUR, { n: 100 }),
  skillAuto('n6', 'ach.n.skillHours', (c) => topSkillMinutes(c) >= 1000 * HOUR, { n: 1000 }),
  skillAuto('n7', 'ach.n.skillHours', (c) => topSkillMinutes(c) >= 5000 * HOUR, { n: 5000 }),
  skillAuto('n8', 'ach.n.skillHours', (c) => topSkillMinutes(c) >= 10_000 * HOUR, {
    n: 10_000,
  }),
  skillAuto('n9', 'ach.n.skillHours', (c) => topSkillMinutes(c) >= 15_000 * HOUR, {
    n: 15_000,
  }),
  skillAuto('na', 'ach.n.skillRank', (c) => rankCount(c, 'expert') >= 2, { n: 2, rank: 'expert' }),
  skillAuto('nb', 'ach.n.skillRank', (c) => rankCount(c, 'skilled') >= 3, { n: 3, rank: 'skilled' }),
  skillAuto('nc', 'ach.n.skillSum', (c) => sumSkillMinutes(c) >= 1000 * HOUR, { n: 1000 }),
  skillAuto('nd', 'ach.n.skillAge', (c) => oldestSkillYears(c) >= 10, { n: 10 }),

  // --- Ритуалы приложения ---
  deed('r1'),
  deed('r2'),
  deed('r3'),
  deed('r4'),
  deed('r5'),
  deed('r6'),
  deed('r7'),
  deed('r8'),
  deed('r9'),

  // --- Жизненные вехи ---
  life('m1'),
  life('m2'),
  life('m3'),
  life('m4'),
  life('m5'),
  life('m6'),
  life('m7'),
  life('m8'),
  life('m9'),
  life('ma'),
  life('mb'),
  life('mc'),
  life('md'),
];

/** Ключ намеренно строковый: из хранилища приходят и идентификаторы будущих версий. */
export const BY_ID = new Map<string, Achievement>(ACHIEVEMENTS.map((item) => [item.id, item]));

// --- Помощники условий -------------------------------------------------------

type Stats = AchievementContext['derived']['last30'];

function hoursOf(ctx: AchievementContext): number {
  return (ctx.derived.totalBlocks * blockMinutesOf(ctx.settings)) / HOUR;
}

/** Часы, накопленные хотя бы одним навыком. */
function topSkillMinutes(ctx: AchievementContext): number {
  return ctx.skills.reduce((max, item) => Math.max(max, item.minutes), 0);
}

/** Сколько активных приоритетов получили хотя бы что-то за период. */
function activeCount(stats: Stats): number {
  return stats.active.filter((item) => item.blocks > 0).length;
}

/**
 * Каждый активный приоритет получил не меньше min блоков.
 *
 * Короткий список не считается: с одним приоритетом условие выполнялось первым
 * же кликом, и «Все на месте» выдавалось человеку, у которого «все» — это один.
 */
function everyActive(stats: Stats, min: number): boolean {
  return (
    stats.active.length >= MIN_SPREAD_PRIORITIES &&
    stats.active.every((item) => item.blocks >= min)
  );
}

/**
 * Сколько блоков за окно нужно, чтобы про баланс вообще было осмысленно говорить.
 * Один клик — это стопроцентная доля лидера, и «перекос признан» за него выдавать
 * нельзя: перекоса ещё нет, есть отсутствие данных.
 */
const BALANCE_MIN_BLOCKS = 20;

/**
 * Доля лидера среди активных приоритетов. Порог по их числу нужен, чтобы
 * «без крена» не выдавалось человеку с двумя приоритетами, у которого
 * равновесие получается само собой.
 *
 * undefined — условие неприменимо. Числового признака здесь быть не должно:
 * любое число проходило бы одно из сравнений и выдавало трофей на пустоте.
 */
function leaderShare(stats: Stats, minActive: number): number | undefined {
  if (stats.totalBlocks < BALANCE_MIN_BLOCKS || stats.active.length < minActive) return undefined;
  return Math.max(...stats.active.map((item) => item.share));
}

function leaderAtMost(stats: Stats, minActive: number, share: number): boolean {
  const leader = leaderShare(stats, minActive);
  return leader !== undefined && leader <= share;
}

function leaderAtLeast(stats: Stats, minActive: number, share: number): boolean {
  const leader = leaderShare(stats, minActive);
  return leader !== undefined && leader >= share;
}

function rankCount(ctx: AchievementContext, floor: RankId): number {
  return ctx.skills.filter((item) => atLeastRank(item.progress.level.rank, floor)).length;
}

function sumSkillMinutes(ctx: AchievementContext): number {
  return ctx.skills.reduce((sum, item) => sum + item.minutes, 0);
}

/** Сколько лет самому давнему навыку по дате начала. */
function oldestSkillYears(ctx: AchievementContext): number {
  let best = 0;
  for (const item of ctx.skills) {
    const started = item.skill.startedOn;
    if (!started) continue;
    const years =
      (ctx.now.getTime() - parseDayKey(started).getTime()) / (365.25 * 24 * 3600 * 1000);
    if (years > best) best = years;
  }
  return best;
}
