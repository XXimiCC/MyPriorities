/**
 * Демо-профили: пять готовых жизней, которые можно показать вместо своей.
 *
 * Профиль — это данные, а не код: сюжет описывается сценарием, разворачивает его
 * общий генератор. Добавить шестого человека значит дописать литерал.
 *
 * Названия — ключи строк, как в наборах приоритетов: демо тоже бывает
 * английским. Разворачивает их генератор, когда собирает историю.
 *
 * Здесь нет ни одного обращения к `window`: файл должен собираться в node,
 * иначе тест профилей пришлось бы гонять в браузерной среде ради ничего.
 * Всё, что знает про адресную строку, живёт в `mode.ts`.
 */

import type { SnapshotContents } from '../domain/snapshot';
import type { StringKey } from '../i18n';
import type { AchievementId } from '../achievements/types';
import { buildStory, type DemoScript } from './generate';

export type DemoId = 'm' | 'f' | 'max' | 'burnout' | 'start';

export interface DemoProfile {
  id: DemoId;
  nameKey: StringKey;
  taglineKey: StringKey;
  /** Ради чего этот профиль открывают — строка под подписью в витрине. */
  showsKey: StringKey;
  /** Акцент карточки — индекс в NEON_PALETTE. */
  accentId: number;
  /** Штрихованные пути в системе координат 24×24, как у наборов. */
  icon: string[];
  script: DemoScript;
}

/**
 * Достижения профиля «Максимум»: id → сколько дней назад выдано.
 *
 * Здесь должен быть весь реестр до последней строки, и стережёт это тест, а не
 * тип: `AchievementId` выведен из ключей `ach.*` и потому шире реестра — в него
 * попадают и `ach.title`, и `ach.filterDone`. Требовать их в этой таблице
 * бессмысленно, а сузить тип значило бы переделывать типизацию реестра ради
 * демо-профиля.
 *
 * Даты разнесены по прошлому намеренно: реестр, выданный целиком сегодняшним
 * числом, выглядит подделкой, каковой и является.
 *
 * Оговорка, которая здесь неизбежна: «Перекос признан» (доля лидера выше
 * семидесяти процентов за тридцать дней) и «Идеальное равновесие» (не выше
 * тридцати) одновременно **заработать** нельзя. Держать — можно: они выданы в
 * разные месяцы, и ровно так это и выглядит в жизни.
 */
const MAX_AWARDS: Partial<Record<AchievementId, number>> = {
  s1: 392, s2: 391, s3: 385, s4: 362, s5: 292, s6: 27,
  h1: 388, h2: 378, h3: 362, h4: 330, h5: 296, h6: 230, h7: 96,
  k1: 389, k2: 385, k3: 378, k4: 362, k5: 332, k6: 292, k7: 27,
  d1: 384, d2: 360, d3: 381, d4: 3, d5: 10, d6: 3,
  b1: 362, b2: 355, b3: 300, b4: 150, b5: 370, b6: 366,
  c1: 392, c2: 385, c3: 362, c4: 340, c5: 350, c6: 344, c7: 330, c8: 310,
  n1: 390, n2: 386, n3: 340, n4: 389, n5: 388, n6: 388, n7: 387, n8: 387,
  n9: 120, na: 250, nb: 300, nc: 387, nd: 387,
  r1: 340, r2: 300, r3: 298, r4: 335, r5: 391, r6: 380, r7: 370, r8: 320, r9: 388,
  m1: 520, m2: 410, m3: 365, m4: 300, m5: 250, m6: 600, m7: 540,
  m8: 200, m9: 480, ma: 270, mb: 700, mc: 450, md: 180,
};

export const DEMO_PROFILES: readonly DemoProfile[] = [
  {
    id: 'm',
    nameKey: 'demo.p.m',
    taglineKey: 'demo.p.m.note',
    showsKey: 'demo.p.m.shows',
    accentId: 1,
    icon: [
      'M13.5 14.5a4.5 4.5 0 10-9 0 4.5 4.5 0 009 0',
      'M12.7 11.3L19 5',
      'M14.5 5H19v4.5',
    ],
    script: {
      // Сид тот же, что был у прежнего `?mock=1`: на этом профиле снимается
      // документация, и менять его без нужды значит пересобирать полсотни кадров.
      seed: 20260731,
      presetId: 'basic',
      archived: [
        { titleKey: 'word.courses', colorId: 2 },
        { titleKey: 'word.renovation', colorId: 5 },
      ],
      spanDays: 45,
      gapChance: 0.12,
      weights: [0.95, 0.5, 0.45, 0.3, 0.2, 0.25, 0.7],
      perDay: [5, 12],
      weekend: 0.7,
      battery: {
        days: 0.85,
        levels: [0.3, 0.4, 0.3],
        charging: 0.12,
        wake: [330, 480],
        night: 0.16,
        drain: 0.55,
        answers: [
          { of: 0 },
          { of: 0 },
          { of: 4 },
          { unknown: true },
          { textKey: 'demo.d.lateNight' },
          { textKey: 'demo.d.commute' },
        ],
      },
      /*
       * Три состояния лестницы разом: самостоятельный с большим стартовым
       * капиталом, привязанный к приоритету и едва начатый. На них опираются
       * сценарии съёмки — менять состав можно, но не молча.
       */
      skills: [
        {
          titleKey: 'word.guitar',
          colorId: 3,
          baseHours: 1640,
          startedOn: '2014-06-01',
          pace: 0.55,
          perDay: [1, 3],
        },
        { titleKey: 'word.coding', colorId: 1, baseHours: 4800, linkTo: 0 },
        { titleKey: 'word.english', colorId: 8, baseHours: 12, pace: 0.3 },
      ],
      awards: { m1: 120, mb: 400, r1: 30 },
    },
  },

  {
    id: 'f',
    nameKey: 'demo.p.f',
    taglineKey: 'demo.p.f.note',
    showsKey: 'demo.p.f.shows',
    accentId: 9,
    icon: ['M16.5 9a4.5 4.5 0 10-9 0 4.5 4.5 0 009 0', 'M12 13.5V21', 'M9 18h6'],
    script: {
      seed: 20260214,
      presetId: 'family',
      archived: [{ titleKey: 'word.studies', colorId: 2 }],
      spanDays: 240,
      gapChance: 0.1,
      weights: [0.8, 0.75, 0.5, 0.6, 0.45, 0.4, 0.5],
      perDay: [6, 12],
      weekend: 1.15,
      battery: {
        days: 0.8,
        levels: [0.2, 0.35, 0.45],
        charging: 0.15,
        wake: [360, 450],
        night: 0.08,
        drain: 0.5,
        answers: [
          { of: 1 },
          { of: 3 },
          { unknown: true },
          { textKey: 'demo.d.noSleep' },
          { textKey: 'demo.d.tooMuch' },
        ],
      },
      skills: [
        { titleKey: 'word.yoga', colorId: 8, baseHours: 900, startedOn: '2019-03-01', pace: 0.5 },
        { titleKey: 'word.english', colorId: 1, baseHours: 320, pace: 0.35 },
        { titleKey: 'word.photography', colorId: 4, baseHours: 1500, startedOn: '2016-05-20', pace: 0.25 },
        {
          titleKey: 'word.culinary',
          colorId: 6,
          baseHours: 2600,
          startedOn: '2012-09-01',
          linkTo: 2,
        },
        { titleKey: 'word.piano', colorId: 3, baseHours: 260, pace: 0.2 },
      ],
      awards: { m3: 210, m4: 90, ma: 150, r1: 40 },
    },
  },

  {
    id: 'max',
    nameKey: 'demo.p.max',
    taglineKey: 'demo.p.max.note',
    showsKey: 'demo.p.max.shows',
    accentId: 8,
    icon: ['M2.5 20.5h19', 'M5 20.5V14', 'M10 20.5V9.5', 'M15 20.5V5.5', 'M19.5 20.5v-8'],
    script: {
      seed: 20260101,
      presetId: 'balance',
      // Три сверх набора — чтобы список был предельным: десять приоритетов,
      // дальше добавить нельзя.
      extra: [
        { titleKey: 'word.creativity', colorId: 5 },
        { titleKey: 'word.travel', colorId: 2 },
        { titleKey: 'word.community', colorId: 8 },
      ],
      archived: [
        { titleKey: 'word.courses', colorId: 2 },
        { titleKey: 'word.renovation', colorId: 5 },
        { titleKey: 'word.sideJob', colorId: 8 },
        { titleKey: 'word.club', colorId: 4 },
      ],
      // Тринадцать месяцев и ни одного пропуска: «Год без единого пропуска» и
      // «Год под наблюдением» иначе недостижимы ни при какой удаче генератора.
      spanDays: 395,
      gapChance: 0,
      weights: [1, 0.95, 0.9, 0.8, 0.85, 0.7, 0.9, 0.6, 0.5, 0.55],
      // Тринадцать с половиной блоков в день на четыреста дней — это те самые
      // две с половиной тысячи часов при получасовом блоке. Проверяется тестом:
      // «Две с половиной тысячи» должно быть заработано, а не только выдано.
      perDay: [10, 17],
      weekend: 0.85,
      peaks: [
        // Полный день: отмечены разом все десять, и блоков за двадцать.
        { back: 3, blocks: { 0: 5, 1: 3, 2: 3, 3: 2, 4: 2, 5: 2, 6: 2, 7: 1, 8: 1, 9: 1 } },
        // Глубокая работа: двенадцать с лишним блоков в одну строку.
        { back: 10, blocks: { 0: 13, 1: 2, 2: 2 } },
      ],
      battery: {
        days: 1,
        levels: [0.25, 0.35, 0.4],
        charging: 0.18,
        wake: [330, 480],
        night: 0.2,
        drain: 0.6,
        answers: [
          { of: 0 },
          { of: 0 },
          { of: 5 },
          { of: 7 },
          { unknown: true },
          { textKey: 'demo.d.badSleep' },
          { textKey: 'demo.d.calls' },
          { textKey: 'demo.d.commute' },
          { textKey: 'demo.d.argument' },
        ],
      },
      /*
       * Двенадцать навыков — потолок каталога — и вся лестница снизу доверху:
       * от «обучение не начато» до пятнадцати тысяч часов. Так на одном экране
       * видно каждый ранг, а не три соседние ступени.
       */
      skills: [
        {
          titleKey: 'word.coding',
          colorId: 1,
          baseHours: 15200,
          startedOn: '2006-09-01',
          linkTo: 0,
        },
        { titleKey: 'word.english', colorId: 2, baseHours: 5400, startedOn: '2009-01-15', pace: 0.3 },
        { titleKey: 'word.guitar', colorId: 3, baseHours: 2600, startedOn: '2011-06-01', pace: 0.25 },
        { titleKey: 'word.photography', colorId: 4, baseHours: 1150, startedOn: '2015-04-10', pace: 0.2 },
        { titleKey: 'word.running', colorId: 0, baseHours: 720, startedOn: '2017-03-01', pace: 0.4 },
        { titleKey: 'word.culinary', colorId: 6, baseHours: 430, pace: 0.3 },
        { titleKey: 'word.chess', colorId: 7, baseHours: 210, pace: 0.15 },
        { titleKey: 'word.drawing', colorId: 5, baseHours: 105, pace: 0.15 },
        { titleKey: 'word.spanish', colorId: 9, baseHours: 55, pace: 0.2 },
        { titleKey: 'word.swimming', colorId: 8, baseHours: 22, pace: 0.1 },
        { titleKey: 'word.meditation', colorId: 3, baseHours: 11, pace: 0.5, perDay: [1, 1] },
        { titleKey: 'word.carpentry', colorId: 6, baseHours: 0.5 },
      ],
      skillsArchived: [
        { titleKey: 'word.calligraphy', colorId: 4, baseHours: 60 },
        { titleKey: 'word.climbing', colorId: 0, baseHours: 180 },
      ],
      awards: MAX_AWARDS,
    },
  },

  {
    id: 'burnout',
    nameKey: 'demo.p.burnout',
    taglineKey: 'demo.p.burnout.note',
    showsKey: 'demo.p.burnout.shows',
    accentId: 5,
    icon: [
      'M3.5 8.5h11a2 2 0 012 2v3a2 2 0 01-2 2h-11a2 2 0 01-2-2v-3a2 2 0 012-2z',
      'M20.5 11v2',
      'M4.8 10.8h2.2v2.4H4.8z',
    ],
    script: {
      seed: 20251111,
      presetId: 'recovery',
      spanDays: 120,
      gapChance: 0.22,
      // Работа стоит последней в наборе «Восстановление» — и забирает всё.
      weights: [0.3, 0.25, 0.15, 0.2, 0.3, 0.2, 0.95],
      perDay: [4, 11],
      weekend: 0.85,
      battery: {
        days: 0.9,
        levels: [0.55, 0.3, 0.15],
        charging: 0.06,
        wake: [400, 540],
        night: 0.25,
        drain: 0.75,
        answers: [
          { of: 6 },
          { of: 6 },
          { of: 6 },
          { unknown: true },
          { textKey: 'demo.d.backToBack' },
          { textKey: 'demo.d.lateAgain' },
          { textKey: 'demo.d.cantSwitchOff' },
        ],
      },
      skills: [
        { titleKey: 'word.running', colorId: 0, baseHours: 120, pace: 0.15 },
        { titleKey: 'word.reading', colorId: 2, baseHours: 400, pace: 0.2 },
      ],
      awards: { m9: 60, r1: 20 },
    },
  },

  {
    id: 'start',
    nameKey: 'demo.p.start',
    taglineKey: 'demo.p.start.note',
    showsKey: 'demo.p.start.shows',
    accentId: 0,
    icon: [
      'M12 21V11',
      'M12 12.5c0-2.5 2-4.5 4.5-4.5 0 2.5-2 4.5-4.5 4.5z',
      'M12 15c0-2.2-1.8-4-4-4 0 2.2 1.8 4 4 4z',
    ],
    script: {
      seed: 20260801,
      presetId: 'basic',
      spanDays: 6,
      gapChance: 0.15,
      weights: [0.9, 0.5, 0.6, 0.4, 0.2, 0.3, 0.5],
      perDay: [2, 5],
      battery: {
        days: 0.6,
        levels: [0.3, 0.4, 0.3],
        charging: 0.1,
        wake: [400, 520],
        night: 0,
        drain: 0.3,
        answers: [{ unknown: true }, { of: 0 }],
      },
      skills: [{ titleKey: 'word.english', colorId: 8, baseHours: 4, pace: 0.4 }],
      // Ничего не выдаём руками: первые достижения на этом профиле должна
      // открыть обычная автоматика — в этом весь сюжет.
    },
  },
];

const BY_ID = new Map<string, DemoProfile>(DEMO_PROFILES.map((item) => [item.id, item]));

export function findProfile(id: string | undefined | null): DemoProfile | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function buildProfile(id: DemoId, now: Date = new Date()): SnapshotContents {
  // Неизвестный идентификатор сюда не попадает: наверх его не пропускает mode.ts.
  return buildStory(BY_ID.get(id)!.script, now);
}
