import { describe, expect, it } from 'vitest';

import { lastNDays } from './date';
import {
  MIN_FILL,
  bestStreak,
  chargeLevel,
  clickStreak,
  computeBatteryStats,
  computeStats,
  currentBatteryLevel,
  dailyBreakdown,
  drainCounts,
  fillFraction,
  initialPeriod,
  nearestChargeLevel,
  periodDays,
} from './stats';
import {
  DEFAULT_BLOCK_MINUTES,
  DEFAULT_MODULES,
  DRAIN_TEXT_MAX,
  DRAIN_UNKNOWN,
  drainCustom,
  drainTextOf,
  type Journal,
  type Priority,
  type Settings,
} from './types';

const NOW = new Date(2026, 6, 31, 12, 0); // 31 июля 2026, 12:00 локального времени

const priority = (id: string, title: string): Priority => ({ id, title, colorId: 0 });

function settingsOf(active: Priority[], archived: Priority[] = [], blockMinutes = DEFAULT_BLOCK_MINUTES): Settings {
  return {
    version: 1,
    priorities: active,
    archived,
    onboarded: true,
    blockMinutes,
    modules: DEFAULT_MODULES,
  };
}

function journalOf(clicks: Journal['clicks'], battery: Journal['battery'] = {}): Journal {
  return { clicks, battery };
}

describe('periodDays', () => {
  it('окно в 7 дней заканчивается сегодняшним днём', () => {
    const days = periodDays({ id: 'week', labelKey: 'period.week', days: 7 }, journalOf({}), NOW);
    expect(days).toHaveLength(7);
    expect(days[6]).toBe('2026-07-31');
    expect(days[0]).toBe('2026-07-25');
  });

  it('окно в 30 дней переходит через границу месяца', () => {
    const days = periodDays({ id: 'month', labelKey: 'period.month', days: 30 }, journalOf({}), NOW);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe('2026-07-02');
  });

  it('«всё время» на пустом журнале — это один сегодняшний день', () => {
    const days = periodDays({ id: 'all', labelKey: 'period.all', days: null }, journalOf({}), NOW);
    expect(days).toEqual(['2026-07-31']);
  });

  it('«всё время» тянется от самой ранней записи до сегодня', () => {
    const journal = journalOf({ '2026-07-28': { a: 1 } }, { '2026-07-26': [[600, 3]] });
    const days = periodDays({ id: 'all', labelKey: 'period.all', days: null }, journal, NOW);
    expect(days[0]).toBe('2026-07-26');
    expect(days[days.length - 1]).toBe('2026-07-31');
    expect(days).toHaveLength(6);
  });
});

describe('период, на котором открывается статистика', () => {
  it('на пустом журнале это «7 дней»: показывать нечего ни в каком окне', () => {
    expect(initialPeriod(journalOf({}), NOW)).toBe('week');
  });

  it('с отметками в последних семи днях это «7 дней»', () => {
    // 28 июля — внутри окна 25–31 июля.
    expect(initialPeriod(journalOf({ '2026-07-28': { a: 3 } }), NOW)).toBe('week');
  });

  it('вернувшемуся на восьмой день открывается «всё время»', () => {
    // 24 июля — ровно за краем окна: единственный день истории.
    expect(initialPeriod(journalOf({ '2026-07-24': { a: 6 } }), NOW)).toBe('all');
  });

  it('отметка батареи в окне — тоже отметка', () => {
    const journal = journalOf({ '2026-07-24': { a: 6 } }, { '2026-07-29': [[600, 3]] });
    expect(initialPeriod(journal, NOW)).toBe('week');
  });

  it('день с нулём блоков за отметку не считается', () => {
    // Такие дни остаются в журнале после того, как счётчик увели обратно в ноль.
    const journal = journalOf({ '2026-07-24': { a: 6 }, '2026-07-29': { a: 0 } });
    expect(initialPeriod(journal, NOW)).toBe('all');
  });
});

describe('заливка по лидеру', () => {
  it('лидер заполнен полностью, остальные — пропорционально ему', () => {
    // Сценарий из задания: 20 часов всего, работа забрала половину и стала максимумом.
    expect(fillFraction(20, 20)).toBe(1);
    expect(fillFraction(10, 20)).toBe(0.5);
    expect(fillFraction(6, 20)).toBeCloseTo(0.3);
  });

  it('без данных все полосы пустые', () => {
    expect(fillFraction(0, 0)).toBe(0);
    expect(fillFraction(0, 20)).toBe(0);
  });

  it('единственный ненулевой приоритет заполнен полностью', () => {
    expect(fillFraction(1, 1)).toBe(1);
  });

  it('один блок на фоне лидера всё равно видно', () => {
    expect(fillFraction(1, 500)).toBe(MIN_FILL);
  });
});

describe('computeStats', () => {
  const work = priority('w', 'Работа');
  const family = priority('f', 'Семья');
  const sport = priority('s', 'Спорт');
  const fun = priority('e', 'Развлечения');

  const settings = settingsOf([work, family, sport, fun]);
  const journal = journalOf({
    '2026-07-31': { w: 20, f: 10, s: 6, e: 4 },
  });
  const days = lastNDays(7, NOW);

  it('переводит блоки в минуты по цене блока', () => {
    const stats = computeStats(settings, journal, days);
    expect(stats.totalBlocks).toBe(40);
    expect(stats.totalMinutes).toBe(40 * DEFAULT_BLOCK_MINUTES);
    expect(stats.active[0]!.minutes).toBe(20 * DEFAULT_BLOCK_MINUTES);
  });

  it('смена цены блока переоценивает и прошлые записи', () => {
    // Хранятся клики, а не часы, поэтому та же история при 60 минутах стоит вдвое больше.
    const cheaper = computeStats(settingsOf([work, family, sport, fun], [], 15), journal, days);
    const pricier = computeStats(settingsOf([work, family, sport, fun], [], 60), journal, days);

    expect(cheaper.totalMinutes).toBe(40 * 15);
    expect(pricier.totalMinutes).toBe(40 * 60);
    // Доли и заливка от цены блока не зависят — это отношения, а не абсолютные величины.
    expect(pricier.active[0]!.share).toBe(cheaper.active[0]!.share);
    expect(pricier.active[1]!.fill).toBe(cheaper.active[1]!.fill);
  });

  it('битое значение цены блока откатывается к значению по умолчанию', () => {
    const broken = { ...settings, blockMinutes: 0 };
    expect(computeStats(broken, journal, days).totalMinutes).toBe(40 * DEFAULT_BLOCK_MINUTES);
  });

  it('доли считаются от общей суммы, а заливка — от лидера', () => {
    const stats = computeStats(settings, journal, days);
    const [w, f, s, e] = stats.active;
    expect(w!.share).toBe(0.5);
    expect(w!.fill).toBe(1);
    expect(f!.fill).toBe(0.5);
    expect(s!.fill).toBeCloseTo(0.3);
    expect(e!.fill).toBeCloseTo(0.2);
  });

  it('сохраняет порядок приоритетов пользователя', () => {
    const stats = computeStats(settings, journal, days);
    expect(stats.active.map((s) => s.priority.id)).toEqual(['w', 'f', 's', 'e']);
  });

  it('суммирует по всем дням окна и игнорирует то, что за его пределами', () => {
    const spread = journalOf({
      '2026-07-31': { w: 2 },
      '2026-07-25': { w: 3 },
      '2026-07-24': { w: 100 }, // на день раньше начала окна
    });
    const stats = computeStats(settings, spread, lastNDays(7, NOW));
    expect(stats.active[0]!.blocks).toBe(5);
  });

  it('архивный приоритет с данными показывается и участвует в нормировке', () => {
    const archived = priority('old', 'Хобби');
    const withArchive = settingsOf([work], [archived]);
    const stats = computeStats(withArchive, journalOf({ '2026-07-31': { w: 5, old: 10 } }), days);

    expect(stats.archived).toHaveLength(1);
    expect(stats.archived[0]!.priority.title).toBe('Хобби');
    expect(stats.archived[0]!.fill).toBe(1);
    // Лидер — архивный, поэтому активный получает половину полосы, а не всю.
    expect(stats.active[0]!.fill).toBe(0.5);
  });

  it('архивный приоритет без данных не показывается', () => {
    const withArchive = settingsOf([work], [priority('old', 'Хобби')]);
    const stats = computeStats(withArchive, journalOf({ '2026-07-31': { w: 5 } }), days);
    expect(stats.archived).toHaveLength(0);
  });

  it('считает дни, в которые вообще что-то отмечали', () => {
    const stats = computeStats(
      settings,
      journalOf({ '2026-07-31': { w: 1 }, '2026-07-29': { f: 2 } }),
      days,
    );
    expect(stats.activeDays).toBe(2);
  });
});

describe('разбивка по дням', () => {
  const work = priority('w', 'Работа');
  const family = priority('f', 'Семья');
  const settings = settingsOf([work, family]);

  it('высота столбца — сумма блоков за день, сегменты в порядке приоритетов', () => {
    const journal = journalOf({ '2026-07-30': { f: 1, w: 3 } });
    const { columns, maxBlocks } = dailyBreakdown(settings, journal, ['2026-07-30']);

    expect(columns[0]!.blocks).toBe(4);
    expect(maxBlocks).toBe(4);
    // В журнале «Семья» шла первой, но порядок задаёт список пользователя.
    expect(columns[0]!.segments.map((s) => s.priority.id)).toEqual(['w', 'f']);
  });

  it('пустые дни остаются в ряду, иначе шкала времени поедет', () => {
    const journal = journalOf({ '2026-07-30': { w: 2 } });
    const { columns } = dailyBreakdown(settings, journal, ['2026-07-29', '2026-07-30', '2026-07-31']);

    expect(columns).toHaveLength(3);
    expect(columns[0]!.blocks).toBe(0);
    expect(columns[0]!.segments).toEqual([]);
  });

  it('масштаб берётся по самому нагруженному дню периода', () => {
    const journal = journalOf({ '2026-07-30': { w: 2 }, '2026-07-31': { w: 9 } });
    expect(dailyBreakdown(settings, journal, ['2026-07-30', '2026-07-31']).maxBlocks).toBe(9);
  });

  it('архивный приоритет тоже попадает в столбец', () => {
    const archived = settingsOf([work], [priority('old', 'Хобби')]);
    const journal = journalOf({ '2026-07-30': { w: 1, old: 2 } });
    const { columns } = dailyBreakdown(archived, journal, ['2026-07-30']);

    expect(columns[0]!.blocks).toBe(3);
    expect(columns[0]!.segments.map((s) => s.priority.title)).toEqual(['Работа', 'Хобби']);
  });

  it('идентификатор без названия пропускается, а не рисуется безымянным', () => {
    const journal = journalOf({ '2026-07-30': { w: 2, ghost: 5 } });
    const { columns } = dailyBreakdown(settings, journal, ['2026-07-30']);

    expect(columns[0]!.segments).toHaveLength(1);
    expect(columns[0]!.blocks).toBe(2);
  });
});

describe('что сажает батарею', () => {
  it('считает ответы по дням периода', () => {
    const journal = journalOf(
      {},
      {
        '2026-07-30': [[540, 1, 'w'], [900, 3]],
        '2026-07-31': [[600, 1, 'w'], [800, 1, 'f']],
      },
    );
    const counts = drainCounts(journal, ['2026-07-30', '2026-07-31']);
    expect(counts.get('w')).toBe(2);
    expect(counts.get('f')).toBe(1);
  });

  it('«не знаю» тоже считается — это ответ, а не его отсутствие', () => {
    const journal = journalOf({}, { '2026-07-30': [[540, 1, DRAIN_UNKNOWN]] });
    // Маркер непустой намеренно: пустую строку разбор отсекал как «ответа не
    // было», и ответ не переживал перезагрузку.
    const counts = drainCounts(journal, ['2026-07-30']);
    expect(counts.size).toBe(1);
    expect(counts.get(DRAIN_UNKNOWN)).toBe(1);
  });

  it('«не знаю» и названный приоритет считаются раздельно', () => {
    const journal = journalOf(
      {},
      { '2026-07-30': [[540, 1, DRAIN_UNKNOWN], [900, 1, 'w']] },
    );
    const counts = drainCounts(journal, ['2026-07-30']);
    expect(counts.get(DRAIN_UNKNOWN)).toBe(1);
    expect(counts.get('w')).toBe(1);
  });

  it('ответ своими словами хранится с префиксом и читается обратно', () => {
    const own = drainCustom('  Дорога в офис  ');
    expect(own).toBe('!Дорога в офис');
    expect(drainTextOf(own!)).toBe('Дорога в офис');
    // Префикс не может совпасть с id приоритета — те из букв и цифр.
    expect(drainTextOf('w')).toBeUndefined();
    expect(drainTextOf(DRAIN_UNKNOWN)).toBeUndefined();
  });

  it('пустой ответ своими словами не создаётся', () => {
    expect(drainCustom('   ')).toBeUndefined();
    expect(drainCustom('')).toBeUndefined();
  });

  it('длинный ответ обрезается до предела', () => {
    const own = drainCustom('я'.repeat(DRAIN_TEXT_MAX + 20))!;
    expect(drainTextOf(own)).toHaveLength(DRAIN_TEXT_MAX);
  });

  it('одинаковые ответы своими словами складываются в одну строку', () => {
    const own = drainCustom('недосып')!;
    const journal = journalOf(
      {},
      { '2026-07-30': [[540, 1, own], [900, 2], [1000, 1, own]] },
    );
    const counts = drainCounts(journal, ['2026-07-30']);
    expect(counts.size).toBe(1);
    expect(counts.get(own)).toBe(2);
  });

  it('переходы без ответа не попадают в подсчёт', () => {
    const journal = journalOf({}, { '2026-07-30': [[540, 1], [900, 2]] });
    expect(drainCounts(journal, ['2026-07-30']).size).toBe(0);
  });

  it('дни вне периода не учитываются', () => {
    const journal = journalOf({}, { '2026-07-29': [[540, 1, 'w']] });
    expect(drainCounts(journal, ['2026-07-30']).size).toBe(0);
  });
});

describe('серия дней', () => {
  it('считает подряд идущие дни с кликами', () => {
    const journal = journalOf({
      '2026-07-31': { w: 1 },
      '2026-07-30': { w: 1 },
      '2026-07-29': { w: 1 },
      '2026-07-27': { w: 1 }, // разрыв на 28-м
    });
    expect(clickStreak(journal, NOW)).toBe(3);
  });

  it('пустой сегодняшний день серию ещё не рвёт', () => {
    const journal = journalOf({ '2026-07-30': { w: 1 }, '2026-07-29': { w: 1 } });
    expect(clickStreak(journal, NOW)).toBe(2);
  });

  it('без кликов серия нулевая', () => {
    expect(clickStreak(journalOf({}), NOW)).toBe(0);
  });
});

describe('рекордная серия', () => {
  it('находит самую длинную серию, а не текущую', () => {
    const journal = journalOf({
      // Пять дней подряд в мае, потом разрыв, потом два дня в июле.
      '2026-05-01': { w: 1 },
      '2026-05-02': { w: 1 },
      '2026-05-03': { w: 1 },
      '2026-05-04': { w: 1 },
      '2026-05-05': { w: 1 },
      '2026-07-30': { w: 1 },
      '2026-07-31': { w: 1 },
    });
    expect(bestStreak(journal)).toBe(5);
    expect(clickStreak(journal, NOW)).toBe(2);
  });

  it('серия считается через границу месяца', () => {
    const journal = journalOf({
      '2026-06-29': { w: 1 },
      '2026-06-30': { w: 1 },
      '2026-07-01': { w: 1 },
    });
    expect(bestStreak(journal)).toBe(3);
  });

  it('день без единого клика серию рвёт', () => {
    const journal = journalOf({
      '2026-07-01': { w: 1 },
      '2026-07-02': { w: 0 },
      '2026-07-03': { w: 1 },
    });
    expect(bestStreak(journal)).toBe(1);
  });

  it('без кликов рекорд нулевой', () => {
    expect(bestStreak(journalOf({}))).toBe(0);
  });
});

describe('длительности состояний батареи', () => {
  it('интервалы внутри одних суток', () => {
    // 08:00 полный, 12:00 средний, 18:00 низкий — сутки уже прошли.
    const journal = journalOf({}, { '2026-07-30': [[480, 3], [720, 2], [1080, 1]] });
    const stats = computeBatteryStats(journal, ['2026-07-30'], NOW);

    expect(stats.minutes[3]).toBe(240); // 08:00–12:00
    expect(stats.minutes[2]).toBe(360); // 12:00–18:00
    expect(stats.minutes[1]).toBe(360); // 18:00–24:00
    // Время до первого переключения не засчитано: состояние тогда было неизвестно.
    expect(stats.totalMinutes).toBe(960);
  });

  it('состояние переносится через полночь на следующие сутки', () => {
    const journal = journalOf({}, { '2026-07-29': [[1320, 2]] }); // выставлено в 22:00 и не менялось
    const stats = computeBatteryStats(journal, ['2026-07-29', '2026-07-30'], NOW);

    expect(stats.minutes[2]).toBe(120 + 1440);
  });

  it('состояние переносится через несколько пустых суток подряд', () => {
    const journal = journalOf({}, { '2026-07-28': [[0, 1]] });
    const stats = computeBatteryStats(journal, ['2026-07-29', '2026-07-30'], NOW);
    expect(stats.minutes[1]).toBe(2880);
  });

  it('текущие сутки считаются только до «сейчас»', () => {
    const journal = journalOf({}, { '2026-07-31': [[540, 3]] }); // сегодня в 09:00, сейчас 12:00
    const stats = computeBatteryStats(journal, ['2026-07-31'], NOW);
    expect(stats.minutes[3]).toBe(180);
  });

  it('незакрытый интервал не убегает в будущее', () => {
    const journal = journalOf({}, { '2026-07-30': [[600, 3]] });
    const stats = computeBatteryStats(journal, ['2026-07-30', '2026-07-31'], NOW);
    // Вчера с 10:00 до полуночи плюс сегодня с полуночи до 12:00.
    expect(stats.minutes[3]).toBe(840 + 720);
  });

  it('переключение ровно в полночь заменяет унаследованное состояние', () => {
    const journal = journalOf({}, { '2026-07-29': [[600, 3]], '2026-07-30': [[0, 1]] });
    const stats = computeBatteryStats(journal, ['2026-07-30'], NOW);
    expect(stats.minutes[3]).toBe(0);
    expect(stats.minutes[1]).toBe(1440);
  });

  it('доминирующее состояние дня — то, в котором провёл больше всего', () => {
    const journal = journalOf({}, { '2026-07-30': [[0, 1], [120, 3]] });
    const stats = computeBatteryStats(journal, ['2026-07-30'], NOW);
    expect(stats.perDay['2026-07-30']).toBe(3);
  });

  it('дни без данных остаются без доминирующего состояния', () => {
    const stats = computeBatteryStats(journalOf({}), ['2026-07-30'], NOW);
    expect(stats.perDay['2026-07-30']).toBeNull();
    expect(stats.totalMinutes).toBe(0);
  });

  it('минуты раскладываются по каждому дню отдельно — из них строится график', () => {
    const journal = journalOf({}, { '2026-07-29': [[0, 3]], '2026-07-30': [[720, 1]] });
    const stats = computeBatteryStats(journal, ['2026-07-29', '2026-07-30'], NOW);

    expect(stats.perDayMinutes['2026-07-29']).toEqual({ 1: 0, 2: 0, 3: 1440, 4: 0 });
    // Полный заряд дотянулся до полудня следующего дня, дальше — «на нуле».
    expect(stats.perDayMinutes['2026-07-30']).toEqual({ 1: 720, 2: 0, 3: 720, 4: 0 });
  });

  it('будущие дни периода «всё время» остаются пустыми, а не наследуют состояние', () => {
    const journal = journalOf({}, { '2026-07-30': [[600, 2]] });
    const stats = computeBatteryStats(journal, ['2026-08-01'], NOW);
    expect(stats.perDayMinutes['2026-08-01']).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0 });
  });

  /*
   * «Отмечали ли» и «набежало ли время» — разные вопросы, и путать их дороже
   * всего в первую минуту: экран статистики иначе отвечает «вы ещё не отмечали»
   * тому, кто отметил секунду назад.
   */
  describe('признак «заряд отмечали»', () => {
    it('пустой журнал — не отмечали', () => {
      const stats = computeBatteryStats(journalOf({}), ['2026-07-30', '2026-07-31'], NOW);
      expect(stats.marked).toBe(false);
    });

    it('отметка, поставленная только что, — уже отмечали, хотя минут ноль', () => {
      // Сейчас 12:00, отметка минутой в 720: длительность честно нулевая.
      const journal = journalOf({}, { '2026-07-31': [[720, 3]] });
      const stats = computeBatteryStats(journal, ['2026-07-31'], NOW);

      expect(stats.totalMinutes).toBe(0);
      expect(stats.marked).toBe(true);
    });

    it('состояние, унаследованное с прошлых суток, тоже считается известным', () => {
      const journal = journalOf({}, { '2026-07-29': [[600, 2]] });
      const stats = computeBatteryStats(journal, ['2026-07-31'], NOW);
      expect(stats.marked).toBe(true);
    });

    it('отметки за пределами периода в него не протекают', () => {
      // Отметка сделана 1 августа, период — только 30 июля: до неё заряд
      // не был известен, и «отмечали» для этого периода неправда.
      const journal = journalOf({}, { '2026-08-01': [[600, 2]] });
      const stats = computeBatteryStats(journal, ['2026-07-30'], NOW);
      expect(stats.marked).toBe(false);
    });

    it('будущий день периода «всё время» сам по себе ничего не отмечает', () => {
      const stats = computeBatteryStats(journalOf({}), ['2026-08-01'], NOW);
      expect(stats.marked).toBe(false);
    });
  });
});

describe('текущий уровень заряда', () => {
  // NOW — 31 июля, 12:00: минута 720.
  it('это последняя отметка, которая уже наступила', () => {
    const journal = journalOf({}, { '2026-07-31': [[480, 3], [660, 2]] });
    expect(currentBatteryLevel(journal, NOW)).toBe(2);
  });

  it('отметка на вечер, вписанная днём, текущим состоянием не становится', () => {
    const journal = journalOf({}, { '2026-07-31': [[480, 3], [1200, 1]] });
    expect(currentBatteryLevel(journal, NOW)).toBe(3);
  });

  it('когда всё сегодняшнее ещё впереди, состояние берётся с прошлых суток', () => {
    const journal = journalOf({}, { '2026-07-30': [[600, 4]], '2026-07-31': [[1200, 1]] });
    expect(currentBatteryLevel(journal, NOW)).toBe(4);
  });

  it('в прошедших сутках наступили все минуты — вечерняя отметка переносится вперёд', () => {
    const journal = journalOf({}, { '2026-07-29': [[1380, 1]] });
    expect(currentBatteryLevel(journal, NOW)).toBe(1);
  });

  it('день из будущего не перебивает сегодняшний', () => {
    const journal = journalOf({}, { '2026-07-31': [[600, 2]], '2026-08-02': [[60, 1]] });
    expect(currentBatteryLevel(journal, NOW)).toBe(2);
  });

  it('без отметок состояния нет', () => {
    expect(currentBatteryLevel(journalOf({}), NOW)).toBeNull();
  });
});

describe('уровень заряда для графика', () => {
  it('шкала: «на нуле» — 0, «средний» — половина, «полный» — 1', () => {
    expect(chargeLevel({ 1: 60, 2: 0, 3: 0, 4: 0 })).toBe(0);
    expect(chargeLevel({ 1: 0, 2: 60, 3: 0, 4: 0 })).toBe(0.5);
    expect(chargeLevel({ 1: 0, 2: 0, 3: 60, 4: 0 })).toBe(1);
  });

  it('день взвешивается по времени, а не по числу переключений', () => {
    // Три часа на нуле и час на полном — это ближе ко дну, чем к середине.
    expect(chargeLevel({ 1: 180, 2: 0, 3: 60, 4: 0 })).toBe(0.25);
  });

  it('восстановление не поднимает и не опускает уровень', () => {
    expect(chargeLevel({ 1: 0, 2: 60, 3: 0, 4: 600 })).toBe(0.5);
  });

  it('день целиком в восстановлении оставляет разрыв, а не ноль', () => {
    expect(chargeLevel({ 1: 0, 2: 0, 3: 0, 4: 1440 })).toBeNull();
    expect(chargeLevel({ 1: 0, 2: 0, 3: 0, 4: 0 })).toBeNull();
  });

  it('точка на графике красится ближайшим уровнем', () => {
    expect(nearestChargeLevel(1)).toBe(3);
    expect(nearestChargeLevel(0.8)).toBe(3);
    expect(nearestChargeLevel(0.5)).toBe(2);
    expect(nearestChargeLevel(0.3)).toBe(2);
    expect(nearestChargeLevel(0.1)).toBe(1);
  });
});
