import { describe, expect, it } from 'vitest';

import { lastNDays } from './date';
import {
  MIN_FILL,
  clickStreak,
  computeBatteryStats,
  computeStats,
  fillFraction,
  periodDays,
} from './stats';
import {
  DEFAULT_BLOCK_MINUTES,
  type Journal,
  type Priority,
  type Settings,
} from './types';

const NOW = new Date(2026, 6, 31, 12, 0); // 31 июля 2026, 12:00 локального времени

const priority = (id: string, title: string): Priority => ({ id, title, colorId: 0 });

function settingsOf(active: Priority[], archived: Priority[] = [], blockMinutes = DEFAULT_BLOCK_MINUTES): Settings {
  return { version: 1, priorities: active, archived, onboarded: true, blockMinutes };
}

function journalOf(clicks: Journal['clicks'], battery: Journal['battery'] = {}): Journal {
  return { clicks, battery };
}

describe('periodDays', () => {
  it('окно в 7 дней заканчивается сегодняшним днём', () => {
    const days = periodDays({ id: 'week', label: '7 дней', days: 7 }, journalOf({}), NOW);
    expect(days).toHaveLength(7);
    expect(days[6]).toBe('2026-07-31');
    expect(days[0]).toBe('2026-07-25');
  });

  it('окно в 30 дней переходит через границу месяца', () => {
    const days = periodDays({ id: 'month', label: '30 дней', days: 30 }, journalOf({}), NOW);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe('2026-07-02');
  });

  it('«всё время» на пустом журнале — это один сегодняшний день', () => {
    const days = periodDays({ id: 'all', label: 'Всё время', days: null }, journalOf({}), NOW);
    expect(days).toEqual(['2026-07-31']);
  });

  it('«всё время» тянется от самой ранней записи до сегодня', () => {
    const journal = journalOf({ '2026-07-28': { a: 1 } }, { '2026-07-26': [[600, 3]] });
    const days = periodDays({ id: 'all', label: 'Всё время', days: null }, journal, NOW);
    expect(days[0]).toBe('2026-07-26');
    expect(days[days.length - 1]).toBe('2026-07-31');
    expect(days).toHaveLength(6);
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
});
