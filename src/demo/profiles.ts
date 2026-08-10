/**
 * Демо-профили: пять готовых жизней, которые можно показать вместо своей.
 *
 * Профиль — это данные, а не код: сюжет описывается сценарием, разворачивает его
 * общий генератор. Добавить шестого человека значит дописать литерал.
 *
 * Здесь нет ни одного обращения к `window`: файл должен собираться в node,
 * иначе тест профилей пришлось бы гонять в браузерной среде ради ничего.
 * Всё, что знает про адресную строку, живёт в `mode.ts`.
 */

import type { SnapshotContents } from '../domain/snapshot';
import type { AchievementId } from '../achievements/types';
import { buildStory, type DemoScript } from './generate';

export type DemoId = 'm' | 'f' | 'max' | 'burnout' | 'start';

export interface DemoProfile {
  id: DemoId;
  name: string;
  tagline: string;
  /** Ради чего этот профиль открывают — строка под подписью в витрине. */
  shows: string;
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
    name: 'Артём',
    tagline: 'Работа съедает почти всё, и это наконец видно',
    shows: 'Обычная жизнь под наблюдением: перекос, серия, три навыка на разных ступенях',
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
        { title: 'Курсы', colorId: 2 },
        { title: 'Ремонт', colorId: 5 },
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
          { text: 'Поздно лёг' },
          { text: 'Дорога через весь город' },
        ],
      },
      /*
       * Три состояния лестницы разом: самостоятельный с большим стартовым
       * капиталом, привязанный к приоритету и едва начатый. На них опираются
       * сценарии съёмки — менять состав можно, но не молча.
       */
      skills: [
        {
          title: 'Гитара',
          colorId: 3,
          baseHours: 1640,
          startedOn: '2014-06-01',
          pace: 0.55,
          perDay: [1, 3],
        },
        { title: 'Программирование', colorId: 1, baseHours: 4800, linkTo: 0 },
        { title: 'Английский', colorId: 8, baseHours: 12, pace: 0.3 },
      ],
      awards: { m1: 120, mb: 400, r1: 30 },
    },
  },

  {
    id: 'f',
    name: 'Марина',
    tagline: 'Дом, дети и своё — без перекоса в одну сторону',
    shows: 'Ровный баланс, восемь месяцев истории, пять навыков',
    accentId: 9,
    icon: ['M16.5 9a4.5 4.5 0 10-9 0 4.5 4.5 0 009 0', 'M12 13.5V21', 'M9 18h6'],
    script: {
      seed: 20260214,
      presetId: 'family',
      archived: [{ title: 'Учёба', colorId: 2 }],
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
          { text: 'Не выспалась' },
          { text: 'Слишком много дел разом' },
        ],
      },
      skills: [
        { title: 'Йога', colorId: 8, baseHours: 900, startedOn: '2019-03-01', pace: 0.5 },
        { title: 'Английский', colorId: 1, baseHours: 320, pace: 0.35 },
        { title: 'Фотография', colorId: 4, baseHours: 1500, startedOn: '2016-05-20', pace: 0.25 },
        {
          title: 'Кулинария',
          colorId: 6,
          baseHours: 2600,
          startedOn: '2012-09-01',
          linkTo: 2,
        },
        { title: 'Фортепиано', colorId: 3, baseHours: 260, pace: 0.2 },
      ],
      awards: { m3: 210, m4: 90, ma: 150, r1: 40 },
    },
  },

  {
    id: 'max',
    name: 'Максимум',
    tagline: 'Тринадцать месяцев, десять приоритетов, весь реестр достижений',
    shows: 'Тестовый аккаунт: здесь заполнено всё, что приложение умеет показать',
    accentId: 8,
    icon: ['M2.5 20.5h19', 'M5 20.5V14', 'M10 20.5V9.5', 'M15 20.5V5.5', 'M19.5 20.5v-8'],
    script: {
      seed: 20260101,
      presetId: 'balance',
      // Три сверх набора — чтобы список был предельным: десять приоритетов и
      // десять цветов палитры, дальше добавить нельзя.
      extra: [
        { title: 'Творчество', colorId: 5 },
        { title: 'Путешествия', colorId: 2 },
        { title: 'Сообщество', colorId: 8 },
      ],
      archived: [
        { title: 'Курсы', colorId: 2 },
        { title: 'Ремонт', colorId: 5 },
        { title: 'Подработка', colorId: 8 },
        { title: 'Клуб', colorId: 4 },
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
          { text: 'Плохо спал' },
          { text: 'Три созвона подряд' },
          { text: 'Дорога через весь город' },
          { text: 'Спор, который того не стоил' },
        ],
      },
      /*
       * Двенадцать навыков — потолок каталога — и вся лестница снизу доверху:
       * от «обучение не начато» до пятнадцати тысяч часов. Так на одном экране
       * видно каждый ранг, а не три соседние ступени.
       */
      skills: [
        {
          title: 'Программирование',
          colorId: 1,
          baseHours: 15200,
          startedOn: '2006-09-01',
          linkTo: 0,
        },
        { title: 'Английский', colorId: 2, baseHours: 5400, startedOn: '2009-01-15', pace: 0.3 },
        { title: 'Гитара', colorId: 3, baseHours: 2600, startedOn: '2011-06-01', pace: 0.25 },
        { title: 'Фотография', colorId: 4, baseHours: 1150, startedOn: '2015-04-10', pace: 0.2 },
        { title: 'Бег', colorId: 0, baseHours: 720, startedOn: '2017-03-01', pace: 0.4 },
        { title: 'Кулинария', colorId: 6, baseHours: 430, pace: 0.3 },
        { title: 'Шахматы', colorId: 7, baseHours: 210, pace: 0.15 },
        { title: 'Рисование', colorId: 5, baseHours: 105, pace: 0.15 },
        { title: 'Испанский', colorId: 9, baseHours: 55, pace: 0.2 },
        { title: 'Плавание', colorId: 8, baseHours: 22, pace: 0.1 },
        { title: 'Медитация', colorId: 3, baseHours: 11, pace: 0.5, perDay: [1, 1] },
        { title: 'Столярка', colorId: 6, baseHours: 0.5 },
      ],
      skillsArchived: [
        { title: 'Каллиграфия', colorId: 4, baseHours: 60 },
        { title: 'Скалолазание', colorId: 0, baseHours: 180 },
      ],
      awards: MAX_AWARDS,
    },
  },

  {
    id: 'burnout',
    name: 'Выгорание',
    tagline: 'Заряд внизу, и причина каждый раз одна и та же',
    shows: 'Сюжет, ради которого всё построено: «Что сажает батарею» во весь экран',
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
          { text: 'Созвоны без перерыва' },
          { text: 'Опять до ночи' },
          { text: 'Никак не выключиться' },
        ],
      },
      skills: [
        { title: 'Бег', colorId: 0, baseHours: 120, pace: 0.15 },
        { title: 'Чтение', colorId: 2, baseHours: 400, pace: 0.2 },
      ],
      awards: { m9: 60, r1: 20 },
    },
  },

  {
    id: 'start',
    name: 'Первая неделя',
    tagline: 'Шесть дней истории и один навык',
    shows: 'Как приложение выглядит в начале: пустые графики и первые достижения',
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
      skills: [{ title: 'Английский', colorId: 8, baseHours: 4, pace: 0.4 }],
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
