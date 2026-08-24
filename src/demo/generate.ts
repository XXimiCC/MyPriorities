/**
 * Генератор демо-историй.
 *
 * Один на все профили: профиль — это сценарий, то есть данные, а не код. Тот же
 * приём, что у наборов приоритетов в `domain/presets.ts`, и по той же причине:
 * добавить ещё один сюжет должно значить дописать литерал, а не ветку.
 *
 * Идентификаторы здесь литеральные, а не через `newShortId`: тот берёт
 * `Math.random()`, и два прогона одного профиля переставали бы совпадать —
 * а на совпадении держатся и скриншоты документации, и тест.
 */

import { addDays, dayKey, minuteOfDay } from '../domain/date';
import { DEFAULT_PRIORITIES, findPreset, titlesOf, type PresetPriority } from '../domain/presets';
import { MAX_ARCHIVED } from '../domain/settings';
import { t, type StringKey } from '../i18n';
import type { SnapshotContents } from '../domain/snapshot';
import {
  DEFAULT_BLOCK_MINUTES,
  DEFAULT_MODULES,
  DRAIN_UNKNOWN,
  MAX_PRIORITIES,
  drainCustom,
  emptyJournal,
  type AwardMap,
  type BatteryLevel,
  type BatteryShift,
  type ClicksMap,
  type DayClicks,
  type DayKey,
  type Journal,
  type Modules,
  type Priority,
  type Settings,
} from '../domain/types';
import { MAX_ARCHIVED_SKILLS, MAX_SKILLS, type Skill, type SkillsState } from '../skills/types';
import { makeRandom, type Random } from './random';

/** Последняя минута, в которую ещё отмечают заряд: дальше уже сон. */
const BEDTIME = 1380;

/** Навык в сценарии: место на лестнице задаётся часами до приложения. */
export interface DemoSkill {
  titleKey: StringKey;
  colorId: number;
  /** Часы, накопленные до приложения. */
  baseHours: number;
  /** Индекс приоритета, чьи клики засчитываются навыку. */
  linkTo?: number;
  startedOn?: DayKey;
  /** Доля дней, в которые по навыку что-то отмечали. */
  pace?: number;
  /** Сколько блоков в такой день. */
  perDay?: [number, number];
  /** Блоки из месяцев, уже свёрнутых за горизонт хранения. */
  carryBlocks?: number;
}

/** Что человек ответил на вопрос «что посадило заряд». */
export type DrainSeed =
  /** Показал на приоритет — индекс в списке. */
  | { of: number }
  /** «Не знаю». */
  | { unknown: true }
  /** Своими словами. */
  | { textKey: StringKey };

export interface BatteryScript {
  /** Доля дней, в которые заряд вообще отмечали. */
  days: number;
  /** Веса уровней «на нуле», «половина», «полный». */
  levels: [number, number, number];
  /** Доля отметок «на зарядке». */
  charging: number;
  /** Во сколько ставят первую отметку дня. */
  wake: [number, number];
  /** Доля дней, когда первая отметка приходится на ночь. */
  night: number;
  /** Доля отметок «на нуле», к которым приписан ответ о расходе. */
  drain: number;
  answers: DrainSeed[];
}

export interface DemoScript {
  seed: number;
  /** Набор, из которого берутся приоритеты. Без него — стартовые семь. */
  presetId?: string;
  /** Приоритеты сверх набора: вместе с ним не больше MAX_PRIORITIES. */
  extra?: PresetPriority[];
  /** Забытые приоритеты — без них у старой истории нет подписей. */
  archived?: PresetPriority[];
  spanDays: number;
  /** Доля пропущенных дней: без пропусков серия и «активные дни» — константа. */
  gapChance: number;
  /** Вес каждого приоритета: он же его доля в дне. */
  weights: number[];
  /** Сколько блоков в обычном дне. */
  perDay: [number, number];
  /** Множитель дневной суммы в субботу и воскресенье. */
  weekend?: number;
  blockMinutes?: number;
  /** Показательные дни: сколько дней назад и что в них лежит (индекс → блоки). */
  peaks?: Array<{ back: number; blocks: Record<number, number> }>;
  battery: BatteryScript;
  skills?: DemoSkill[];
  skillsArchived?: DemoSkill[];
  foldedThrough?: string;
  /** Достижения: id → сколько дней назад выдано. */
  awards?: Readonly<Partial<Record<string, number>>>;
  modules?: Partial<Modules>;
}

/**
 * Хвост идентификатора. Двухсимвольные — потому же, почему и у настоящих:
 * id повторяется в каждом дне истории, и лишний символ стоит процентов от лимита.
 */
const SUFFIX = '123456789abcdefghijklmnopqrstuvwxyz';

function seriesId(prefix: string, index: number): string {
  return prefix + (SUFFIX[index] ?? String(index));
}

export function buildStory(script: DemoScript, now: Date = new Date()): SnapshotContents {
  const random = makeRandom(script.seed);
  const settings = buildSettings(script);
  const journal = buildJournal(script, settings, random, now);
  const { skills, skillClicks } = buildSkills(script, settings, random, now);
  return { settings, journal, skills, skillClicks, awards: buildAwards(script, now) };
}

// --- Настройки ---------------------------------------------------------------

function buildSettings(script: DemoScript): Settings {
  const preset = findPreset(script.presetId);
  const source = titlesOf([...(preset?.priorities ?? DEFAULT_PRIORITIES), ...(script.extra ?? [])]);

  const priorities: Priority[] = source.slice(0, MAX_PRIORITIES).map((item, index) => ({
    id: seriesId('p', index),
    title: item.title,
    colorId: item.colorId,
  }));

  const archived: Priority[] = titlesOf(script.archived ?? []).slice(0, MAX_ARCHIVED).map((item, index) => ({
    id: seriesId('z', index),
    title: item.title,
    colorId: item.colorId,
  }));

  return {
    version: 1,
    priorities,
    archived,
    /*
     * Отметка о наборе ставится, только пока список — это ровно он. Дописанные
     * сверху приоритеты делают строку «Сейчас: Базовый» неправдой, а настройки
     * читают её как есть.
     */
    ...(script.presetId && !script.extra?.length ? { presetId: script.presetId } : {}),
    onboarded: true,
    blockMinutes: script.blockMinutes ?? DEFAULT_BLOCK_MINUTES,
    modules: { ...DEFAULT_MODULES, ...script.modules },
  };
}

// --- Клики -------------------------------------------------------------------

/**
 * Раскладывает дневную сумму по приоритетам пропорционально весам.
 *
 * Сумма задаётся сценарием, а не получается сама: от неё напрямую зависят часы,
 * а от часов — достижения. Профиль, который обещает две с половиной тысячи
 * часов, должен их выдать, а не как повезёт генератору.
 */
function spread(total: number, weights: number[], random: Random): Record<number, number> {
  const sum = weights.reduce((acc, value) => acc + value, 0);
  if (sum <= 0 || total <= 0) return {};

  const out: Record<number, number> = {};
  let left = total;

  weights.forEach((weight, index) => {
    if (left <= 0 || weight <= 0) return;
    // Дрожание вокруг доли: ровные проценты изо дня в день читаются как таблица,
    // а не как жизнь.
    const share = (weight / sum) * total * (0.55 + random.next() * 0.9);
    const blocks = Math.min(left, Math.round(share));
    if (blocks > 0) {
      out[index] = blocks;
      left -= blocks;
    }
  });

  /*
   * Остаток раздаётся по кругу со случайного места, а не лидеру.
   *
   * Отдавать его самому весомому казалось проще, но именно это ломало баланс:
   * лидер получал округление каждого дня и уезжал за семьдесят процентов, а
   * достижения «без крена» становились недостижимы ни на одном профиле.
   */
  let index = random.between(0, weights.length - 1);
  let guard = total + weights.length;
  while (left > 0 && guard > 0) {
    if ((weights[index] ?? 0) > 0) {
      out[index] = (out[index] ?? 0) + 1;
      left -= 1;
    }
    index = (index + 1) % weights.length;
    guard -= 1;
  }

  return out;
}

function buildJournal(
  script: DemoScript,
  settings: Settings,
  random: Random,
  now: Date,
): Journal {
  const journal = emptyJournal();
  const weights = settings.priorities.map((_, index) => script.weights[index] ?? 0.3);

  for (let back = script.spanDays - 1; back >= 0; back -= 1) {
    /*
     * Сегодняшний день не пропускается никогда. Демо открывают на вкладке
     * «Сегодня», и выпавший по жребию пропуск встречал человека пустым экраном
     * с нулями — то есть ровно тем, чего в демо и быть не должно. Остальные дни
     * пропускаются как раньше: без дыр серия и «активные дни» превращаются
     * в константу.
     */
    if (back > 0 && random.chance(script.gapChance)) continue;

    const date = addDays(now, -back);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    /*
     * Объём сегодняшнего дня не урезается «потому что день в разгаре».
     * Урезанный вдвое день расходится по десяти приоритетам «Максимума» по
     * одному блоку на каждый, и все полосы становятся одной длины — картина
     * ровно противоположная тому, ради чего демо и открывают.
     */
    const total = Math.round(
      random.between(script.perDay[0], script.perDay[1]) * (weekend ? script.weekend ?? 1 : 1),
    );

    const entry: DayClicks = {};
    for (const [index, blocks] of Object.entries(spread(total, weights, random))) {
      const priority = settings.priorities[Number(index)];
      if (priority) entry[priority.id] = blocks;
    }
    if (Object.keys(entry).length > 0) journal.clicks[dayKey(date)] = entry;
  }

  // Показательные дни ставятся поверх: «двадцать блоков» и «полный день» —
  // это про конкретный день, и оставлять их на удачу нельзя.
  for (const peak of script.peaks ?? []) {
    const entry: DayClicks = {};
    for (const [index, blocks] of Object.entries(peak.blocks)) {
      const priority = settings.priorities[Number(index)];
      if (priority && blocks > 0) entry[priority.id] = blocks;
    }
    if (Object.keys(entry).length > 0) journal.clicks[dayKey(addDays(now, -peak.back))] = entry;
  }

  journal.battery = buildBattery(script, settings, random, now);
  return journal;
}

// --- Заряд -------------------------------------------------------------------

function pickLevel(weights: [number, number, number], random: Random): BatteryLevel {
  const sum = weights[0] + weights[1] + weights[2];
  let roll = random.next() * (sum > 0 ? sum : 1);
  for (let index = 0; index < 3; index += 1) {
    roll -= weights[index]!;
    if (roll < 0) return (index + 1) as BatteryLevel;
  }
  return 3;
}

function drainValue(seed: DrainSeed, settings: Settings): string | undefined {
  if ('unknown' in seed) return DRAIN_UNKNOWN;
  if ('textKey' in seed) return drainCustom(t(seed.textKey));
  return settings.priorities[seed.of]?.id;
}

function buildBattery(
  script: DemoScript,
  settings: Settings,
  random: Random,
  now: Date,
): Record<DayKey, BatteryShift[]> {
  const out: Record<DayKey, BatteryShift[]> = {};
  const plan = script.battery;

  for (let back = script.spanDays - 1; back >= 0; back -= 1) {
    if (!random.chance(plan.days)) continue;

    /*
     * Сегодняшний день обрывается на «сейчас»: у демо не должно быть будущего.
     *
     * Это не косметика. Отметка — это «уже случилось»: руками время позже
     * текущей минуты поставить нельзя, и выданное генератором не должно быть
     * тем, чего человек не смог бы отметить сам. Вечер, выданный в полдень,
     * встал бы в ленту отметок будущим временем и с длительностью «до сих пор».
     *
     * Раньше он вдобавок объявлялся «текущим зарядом», и живое переключение
     * после этого не меняло на экране ничего. Теперь текущий уровень считается
     * до текущей минуты (`currentBatteryLevel` в domain/stats.ts), но обрыв
     * остаётся: демо показывает прожитый день, а не расписание.
     */
    const ceiling = back === 0 ? Math.min(BEDTIME, minuteOfDay(now)) : BEDTIME;

    const shifts: BatteryShift[] = [];
    // Ночное начало — не украшение: «Сова» и «Жаворонок» считаются по минуте
    // первой отметки, и без разброса ни одно из двух не выдаётся никогда.
    let minute = random.chance(plan.night)
      ? random.between(70, 290)
      : random.between(plan.wake[0], plan.wake[1]);

    while (minute < ceiling) {
      const level = random.chance(plan.charging) ? 4 : pickLevel(plan.levels, random);
      // Ответ приписывается только к «на нуле»: спрашивают ровно там.
      const answer =
        level === 1 && plan.answers.length > 0 && random.chance(plan.drain)
          ? drainValue(random.pick(plan.answers), settings)
          : undefined;

      shifts.push(answer === undefined ? [minute, level] : [minute, level, answer]);
      minute += random.between(110, 430);
    }

    if (shifts.length > 0) out[dayKey(addDays(now, -back))] = shifts;
  }

  return out;
}

// --- Навыки ------------------------------------------------------------------

function buildSkills(
  script: DemoScript,
  settings: Settings,
  random: Random,
  now: Date,
): { skills: SkillsState; skillClicks: ClicksMap } {
  const planned = (script.skills ?? []).slice(0, MAX_SKILLS);
  const linked = new Set<string>();

  const skills: Skill[] = planned.map((item, index) => {
    const priority = item.linkTo === undefined ? undefined : settings.priorities[item.linkTo];
    // Один приоритет кормит не больше одного навыка: две привязки означали бы,
    // что одни и те же часы засчитаны дважды.
    const link = priority && !linked.has(priority.id) ? priority.id : undefined;
    if (link) linked.add(link);

    return {
      id: seriesId('k', index),
      title: t(item.titleKey),
      colorId: item.colorId,
      baseMinutes: Math.round(item.baseHours * 60),
      carryBlocks: item.carryBlocks ?? 0,
      ...(link ? { linkedPriorityId: link } : {}),
      ...(item.startedOn ? { startedOn: item.startedOn } : {}),
    };
  });

  const archived: Skill[] = (script.skillsArchived ?? [])
    .slice(0, MAX_ARCHIVED_SKILLS)
    // Префикс свой: список идентификаторов у активных и архивных общий.
    .map((item, index) => ({
      id: seriesId('y', index),
      title: t(item.titleKey),
      colorId: item.colorId,
      baseMinutes: Math.round(item.baseHours * 60),
      carryBlocks: item.carryBlocks ?? 0,
      ...(item.startedOn ? { startedOn: item.startedOn } : {}),
    }));

  const skillClicks: ClicksMap = {};
  for (let back = script.spanDays - 1; back >= 0; back -= 1) {
    const entry: DayClicks = {};

    planned.forEach((item, index) => {
      if (!random.chance(item.pace ?? 0)) return;
      const [min, max] = item.perDay ?? [1, 2];
      entry[skills[index]!.id] = random.between(min, max);
    });

    if (Object.keys(entry).length > 0) skillClicks[dayKey(addDays(now, -back))] = entry;
  }

  return {
    skills: {
      skills,
      archived,
      ...(script.foldedThrough ? { foldedThrough: script.foldedThrough } : {}),
    },
    skillClicks,
  };
}

// --- Достижения --------------------------------------------------------------

function buildAwards(script: DemoScript, now: Date): AwardMap {
  const out: AwardMap = {};
  for (const [id, back] of Object.entries(script.awards ?? {})) {
    if (back === undefined) continue;
    out[id] = dayKey(addDays(now, -back));
  }
  return out;
}
