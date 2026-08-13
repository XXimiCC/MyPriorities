import { describe, expect, it } from 'vitest';

import { derive } from '../achievements/derive';
import { addDays, dayKey, lastNDays } from './date';
import { insightText, insights, type InsightId } from './insights';
import {
  DEFAULT_MODULES,
  type BatteryLevel,
  type DayKey,
  type Journal,
  type Settings,
} from './types';

const NOW = new Date(2026, 6, 31, 12, 0); // 31 июля 2026, полдень

const settings: Settings = {
  version: 1,
  priorities: [
    { id: 'ab', title: 'Работа', colorId: 0 },
    { id: 'cd', title: 'Семья', colorId: 1 },
  ],
  archived: [],
  onboarded: true,
  blockMinutes: 30,
  modules: DEFAULT_MODULES,
};

function empty(): Journal {
  return { clicks: {}, battery: {} };
}

/** Ключ дня, отстоящего от NOW на указанное число суток назад. */
function back(days: number): DayKey {
  return dayKey(addDays(NOW, -days));
}

function run(journal: Journal): InsightId[] {
  return insights(settings, derive(settings, journal, NOW), NOW).map((item) => item.id);
}

function find(journal: Journal, id: InsightId): string | undefined {
  const item = insights(settings, derive(settings, journal, NOW), NOW).find((i) => i.id === id);
  return item ? insightText(item) : undefined;
}

/**
 * Заряд задаётся каждому дню явно. Иначе день без переходов унаследовал бы
 * состояние предыдущего, и корзины разъехались бы незаметно для теста.
 */
function charge(journal: Journal, day: DayKey, level: BatteryLevel): void {
  journal.battery[day] = [[0, level]];
}

describe('пороги: на бедных данных наблюдений нет', () => {
  it('пустая история не даёт ни одного наблюдения', () => {
    expect(run(empty())).toEqual([]);
  });

  it('один день не даёт ни одного наблюдения', () => {
    const journal = empty();
    journal.clicks[back(0)] = { ab: 6, cd: 2 };
    charge(journal, back(0), 1);
    expect(run(journal)).toEqual([]);
  });

  it('корзина заряда с одним днём молчит, а не показывает долю', () => {
    // Один день на нуле против трёх полных: сравнивать не с чем, и «в дни на
    // нуле работы вдвое больше» здесь было бы утверждением ни о чём.
    const journal = empty();
    charge(journal, back(3), 1);
    journal.clicks[back(3)] = { ab: 8 };
    for (const d of [2, 1, 0]) {
      charge(journal, back(d), 3);
      journal.clicks[back(d)] = { ab: 1 };
    }
    expect(run(journal)).not.toContain('charge');
  });
});

describe('заряд и приоритеты', () => {
  function split(lowDays: number, highDays: number): Journal {
    const journal = empty();
    let offset = 0;
    for (let i = 0; i < lowDays; i += 1, offset += 1) {
      charge(journal, back(offset), 1);
      journal.clicks[back(offset)] = { ab: 4, cd: 1 };
    }
    for (let i = 0; i < highDays; i += 1, offset += 1) {
      charge(journal, back(offset), 3);
      journal.clicks[back(offset)] = { ab: 1, cd: 1 };
    }
    return journal;
  }

  it('сравнивает темп за день, а не суммы', () => {
    expect(run(split(3, 3))).toContain('charge');
    // 4 блока по 30 минут против одного: два часа против получаса.
    expect(find(split(3, 3), 'charge')).toBe(
      'Когда заряд низкий, Работа забирает 2 ч в день. Когда полный — 30 м.',
    );
  });

  it('приоритет с ровным темпом наблюдения не даёт', () => {
    // У «Семьи» по одному блоку в обеих корзинах — разрыва нет.
    const text = find(split(3, 3), 'charge');
    expect(text).not.toContain('Семья');
  });

  it('дни среднего заряда не попадают ни в одну корзину', () => {
    const journal = empty();
    for (let i = 0; i < 6; i += 1) {
      charge(journal, back(i), 2);
      journal.clicks[back(i)] = { ab: 8 };
    }
    expect(run(journal)).not.toContain('charge');
  });
});

describe('неделя против предыдущей', () => {
  it('видит спад', () => {
    const journal = empty();
    // Окна стыкуются встык: текущая неделя — дни 0..6 назад, предыдущая — 7..13.
    for (let i = 7; i <= 13; i += 1) journal.clicks[back(i)] = { ab: 3 };
    for (let i = 0; i <= 6; i += 1) journal.clicks[back(i)] = { ab: 1 };
    expect(find(journal, 'weekOverWeek')).toBe(
      'На Работа за неделю ушло 3,5 ч. На прошлой неделе было 10,5 ч.',
    );
  });

  it('видит рост', () => {
    const journal = empty();
    for (let i = 7; i <= 13; i += 1) journal.clicks[back(i)] = { ab: 2 };
    for (let i = 0; i <= 6; i += 1) journal.clicks[back(i)] = { ab: 5 };
    // Направление читается из самих чисел: текст на обе стороны один.
    expect(find(journal, 'weekOverWeek')).toBe(
      'На Работа за неделю ушло 17,5 ч. На прошлой неделе было 7 ч.',
    );
  });

  it('пустая предыдущая неделя сравнения не даёт', () => {
    const journal = empty();
    for (let i = 0; i <= 6; i += 1) journal.clicks[back(i)] = { ab: 5 };
    expect(run(journal)).not.toContain('weekOverWeek');
  });
});

describe('затихший приоритет', () => {
  it('находит тот, что был в месяце и пропал из недели', () => {
    const journal = empty();
    for (let i = 8; i <= 20; i += 1) journal.clicks[back(i)] = { ab: 2 };
    for (let i = 0; i <= 6; i += 1) journal.clicks[back(i)] = { cd: 2 };
    const text = find(journal, 'quiet');
    expect(text).toContain('Работа не отмечался 8 дней');
  });

  it('приоритет, которого не было никогда, не считается затихшим', () => {
    const journal = empty();
    for (let i = 0; i <= 6; i += 1) journal.clicks[back(i)] = { ab: 2 };
    expect(run(journal)).not.toContain('quiet');
  });
});

describe('концентрация', () => {
  it('считает дни, дающие 80% месяца', () => {
    const journal = empty();
    for (const d of [3, 5, 7]) journal.clicks[back(d)] = { ab: 8 };
    for (const d of [9, 11, 13, 15, 17, 19, 21, 23, 25]) journal.clicks[back(d)] = { ab: 1 };
    expect(find(journal, 'concentration')).toBe(
      '80% месяца сложились из 6 дней. Всего с отметками — 12 дней.',
    );
  });

  it('ровный месяц наблюдения не даёт', () => {
    const journal = empty();
    for (let i = 0; i < 25; i += 1) journal.clicks[back(i)] = { ab: 2 };
    expect(run(journal)).not.toContain('concentration');
  });
});

describe('будни и выходные', () => {
  it('нормирует на число дней, а не сравнивает суммы', () => {
    const journal = empty();
    // По два блока в каждый будний день и по шесть в каждый выходной: сумма
    // будней всё равно больше, но в день выходные заметно плотнее.
    for (const day of lastNDays(30, NOW)) {
      const weekend = [0, 6].includes(new Date(`${day}T00:00:00`).getDay());
      journal.clicks[day] = { ab: weekend ? 6 : 2 };
    }
    const text = find(journal, 'weekend');
    expect(text).toBe('В будни ты инвестируешь в приоритеты 1 ч в день, в выходные — 3 ч.');
  });

  it('одинаковый темп наблюдения не даёт', () => {
    const journal = empty();
    for (const day of lastNDays(30, NOW)) journal.clicks[day] = { ab: 3 };
    expect(run(journal)).not.toContain('weekend');
  });

  it('разница, тонущая в самих числах, наблюдения не даёт', () => {
    // Девять блоков против десяти — абсолютный разрыв порог проходит, но
    // «4,5 часа против пяти» не сообщает ничего и карточки не заслуживает.
    const journal = empty();
    for (const day of lastNDays(30, NOW)) {
      const weekend = [0, 6].includes(new Date(`${day}T00:00:00`).getDay());
      journal.clicks[day] = { ab: weekend ? 10 : 9 };
    }
    expect(run(journal)).not.toContain('weekend');
  });
});

describe('во сколько садится заряд', () => {
  it('берёт медиану первых падений за день', () => {
    const journal = empty();
    const minutes = [10 * 60, 22 * 60, 18 * 60, 20 * 60, 19 * 60];
    minutes.forEach((minute, i) => {
      journal.battery[back(i)] = [
        [0, 3],
        [minute, 1],
      ];
    });
    // Медиана из 10:00, 18:00, 19:00, 20:00, 22:00 — девятнадцать часов.
    expect(find(journal, 'lowOnset')).toBe('Заряд обычно садится до нуля около 19:00.');
  });

  it('четырёх дней мало', () => {
    const journal = empty();
    for (let i = 0; i < 4; i += 1) {
      journal.battery[back(i)] = [
        [0, 3],
        [19 * 60, 1],
      ];
    }
    expect(run(journal)).not.toContain('lowOnset');
  });

  it('считается первое падение за сутки, а не последнее', () => {
    const journal = empty();
    for (let i = 0; i < 5; i += 1) {
      journal.battery[back(i)] = [
        [0, 3],
        [14 * 60, 1],
        [16 * 60, 3],
        [23 * 60, 1],
      ];
    }
    expect(find(journal, 'lowOnset')).toContain('14:00');
  });
});

describe('формы слов', () => {
  it('склоняет число дней в тексте наблюдения', () => {
    const forms: Record<number, string> = { 8: '8 дней', 9: '9 дней', 12: '12 дней' };
    for (const [days, expected] of Object.entries(forms)) {
      const journal = empty();
      const gap = Number(days);
      for (let i = gap; i <= gap + 12; i += 1) journal.clicks[back(i)] = { ab: 2 };
      for (let i = 0; i <= 6; i += 1) journal.clicks[back(i)] = { cd: 2 };
      expect(find(journal, 'quiet')).toContain(expected);
    }
  });
});
