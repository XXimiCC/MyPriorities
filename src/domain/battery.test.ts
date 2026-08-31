import { describe, expect, it } from 'vitest';

import {
  LAST_MINUTE,
  NIGHT_DEFAULT_BEDTIME,
  formatTime,
  lastShift,
  nightAsk,
  nightBedtime,
  parseTime,
  removeShift,
  sanitizeShifts,
  setShift,
  type LastShift,
} from './battery';
import { emptyJournal, type BatteryShift, type Journal } from './types';

const day = (): BatteryShift[] => [
  [480, 3],
  [720, 2],
  [1080, 1, 'ab'],
];

describe('добавление отметки', () => {
  it('встаёт в правильное место по времени', () => {
    // Ровно тот случай, ради которого это и сделано: забыли включить зарядку
    // перед сном, вспомнили утром и дописали отметку в 23:00.
    expect(setShift(day(), 1380, 4)).toEqual([
      [480, 3],
      [720, 2],
      [1080, 1, 'ab'],
      [1380, 4],
    ]);
  });

  it('в пустой день', () => {
    expect(setShift([], 600, 2)).toEqual([[600, 2]]);
  });

  it('минута за пределами суток прижимается к краю', () => {
    expect(setShift([], 5000, 2)[0]![0]).toBe(LAST_MINUTE);
    expect(setShift([], -10, 2)[0]![0]).toBe(0);
  });

  it('вторая отметка на ту же минуту заменяет первую', () => {
    // Переключиться дважды в одну минуту нельзя — это правка, а не новая отметка.
    const shifts = setShift(day(), 720, 4);
    expect(shifts).toHaveLength(3);
    expect(shifts.find((s) => s[0] === 720)).toEqual([720, 4]);
  });
});

describe('правка отметки', () => {
  it('перенос времени не оставляет старую запись', () => {
    const shifts = setShift(day(), 900, 2, 720);
    expect(shifts.map((s) => s[0])).toEqual([480, 900, 1080]);
  });

  it('причина «на нуле» переезжает вместе с отметкой', () => {
    expect(setShift(day(), 1200, 1, 1080)).toContainEqual([1200, 1, 'ab']);
  });

  it('со сменой уровня причина исчезает', () => {
    // У полного заряда причины разряда быть не может.
    const shifts = setShift(day(), 1080, 3, 1080);
    expect(shifts.find((s) => s[0] === 1080)).toEqual([1080, 3]);
  });

  it('порядок восстанавливается, если время уехало назад', () => {
    expect(setShift(day(), 60, 1, 1080).map((s) => s[0])).toEqual([60, 480, 720]);
  });
});

describe('удаление отметки', () => {
  it('убирает только свою минуту', () => {
    expect(removeShift(day(), 720).map((s) => s[0])).toEqual([480, 1080]);
  });

  it('несуществующая минута ничего не меняет', () => {
    expect(removeShift(day(), 999)).toHaveLength(3);
  });
});

describe('время', () => {
  it('выводится с ведущими нулями', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(1439)).toBe('23:59');
  });

  it('разбирается обратно', () => {
    expect(parseTime('07:30')).toBe(450);
    expect(parseTime('7:30')).toBe(450);
    expect(parseTime('00:00')).toBe(0);
  });

  it('мусор и несуществующее время не принимаются', () => {
    // Поле могли очистить или ввести руками — молча подставлять полночь нельзя.
    for (const bad of ['', 'вечером', '25:00', '12:60', '1230']) {
      expect(parseTime(bad)).toBeUndefined();
    }
  });
});

describe('приведение отметок к валидному виду', () => {
  it('минута за концом суток прижимается к последней', () => {
    /*
     * 1440 — минута следующих суток, и приехать она может из файла копии или
     * из облака. Предел здесь обязан совпадать с clampMinute: пока их было два,
     * setShift такую отметку не создавал, а sanitizeShifts пропускал.
     */
    expect(sanitizeShifts([[1440, 2]])).toEqual([[LAST_MINUTE, 2]]);
    expect(sanitizeShifts([[99999, 3]])).toEqual([[LAST_MINUTE, 3]]);
    expect(sanitizeShifts([[-5, 4]])).toEqual([[0, 4]]);
  });

  it('сортирует по времени и отбрасывает непохожее на отметку', () => {
    expect(
      sanitizeShifts([[720, 2], ['утро', 3], [480, 9], [60, 4], null, [1080, 1, 'ab']]),
    ).toEqual([
      [60, 4],
      [720, 2],
      [1080, 1, 'ab'],
    ]);
  });
});

// --- Ночь --------------------------------------------------------------------

/** Журнал с отметками ровно там, где нужно тесту. */
const journalOf = (battery: Journal['battery']): Journal => ({ ...emptyJournal(), battery });

/** Утро после вечера «на нуле»: тот самый случай, ради которого всё сделано. */
const evening = (): Journal => journalOf({ '2026-03-09': [[1320, 1]] });

const at = (hour: number, minute = 0): Date => new Date(2026, 2, 10, hour, minute);

describe('последняя отметка журнала', () => {
  it('берётся из самых свежих суток, а не из первых попавшихся', () => {
    const journal = journalOf({
      '2026-03-09': [[1320, 1]],
      '2026-03-08': [[600, 3]],
      '2026-03-10': [[60, 2]],
    });
    expect(lastShift(journal)).toEqual({ day: '2026-03-10', minute: 60, level: 2 });
  });

  it('пустые дни не считаются днями с отметками', () => {
    expect(lastShift(journalOf({ '2026-03-10': [] }))).toBeUndefined();
  });

  it('пустого журнала нет', () => {
    expect(lastShift(emptyJournal())).toBeUndefined();
  });
});

describe('спрашивать ли про ночь', () => {
  it('спрашиваем утром после долгой паузы', () => {
    const ask = nightAsk(evening(), {}, at(7));
    expect(ask).not.toBeNull();
    expect(ask!.bedtime).toBe(NIGHT_DEFAULT_BEDTIME);
    expect(ask!.last).toEqual({ day: '2026-03-09', minute: 1320, level: 1 });
  });

  it('до четырёх утра и после полудня молчим', () => {
    expect(nightAsk(evening(), {}, at(3, 59))).toBeNull();
    expect(nightAsk(evening(), {}, at(12))).toBeNull();
  });

  it('паузы меньше пяти часов не хватает', () => {
    // Отметка в 04:30, вопрос в 09:29 — это перерыв, а не ночь.
    const journal = journalOf({ '2026-03-10': [[270, 2]] });
    expect(nightAsk(journal, {}, at(9, 29))).toBeNull();
    expect(nightAsk(journal, {}, at(9, 30))).not.toBeNull();
  });

  it('«Заряжаюсь» вечером означает, что ночь уже отмечена', () => {
    expect(nightAsk(journalOf({ '2026-03-09': [[1320, 4]] }), {}, at(7))).toBeNull();
  });

  it('тому, кто ни разу не отмечал заряд, не предлагаем', () => {
    expect(nightAsk(emptyJournal(), {}, at(7))).toBeNull();
  });

  it('сегодня уже спрашивали — до завтра не возвращаемся', () => {
    expect(nightAsk(evening(), { askedOn: '2026-03-10' }, at(7))).toBeNull();
    // Вчерашний отказ сегодняшнему вопросу не мешает.
    expect(nightAsk(evening(), { askedOn: '2026-03-09' }, at(7))).not.toBeNull();
  });

  it('подставляется прошлый ответ этого устройства', () => {
    expect(nightAsk(evening(), { bedtime: 90 }, at(7))!.bedtime).toBe(90);
  });

  it('не проходящий в границы ответ подтягивается к границе', () => {
    // Вечерняя отметка в 23:30, а прошлый ответ — 23:00: такая отметка встала бы
    // раньше существующей и ничего бы не починила.
    const journal = journalOf({ '2026-03-09': [[1410, 1]] });
    expect(nightAsk(journal, { bedtime: 1380 }, at(7))!.bedtime).toBe(1411);
  });

  it('граница окна — минута сразу после последней отметки', () => {
    const ask = nightAsk(evening(), {}, at(7))!;
    expect(ask.from).toBe(1321);
    expect(ask.to).toBe(7 * 60);
  });

  it('давняя отметка границы не ставит: окно открыто целиком', () => {
    // Приложение не открывали неделю — любое введённое время всё равно позже.
    const ask = nightAsk(journalOf({ '2026-03-01': [[1320, 1]] }), {}, at(7))!;
    expect(ask.from).toBe(7 * 60 + 1);
    expect(ask.to).toBe(7 * 60);
  });
});

describe('время отхода ко сну', () => {
  const last: LastShift = { day: '2026-03-09', minute: 1320, level: 1 };

  it('время больше текущего — это вчерашние сутки', () => {
    expect(nightBedtime(23 * 60, last, at(7))).toEqual({ day: '2026-03-09', minute: 1380 });
  });

  it('время меньше текущего — сегодняшние', () => {
    // Легли в час тридцать ночи: отметка в сегодняшнем дне на минуте 90.
    expect(nightBedtime(90, last, at(7))).toEqual({ day: '2026-03-10', minute: 90 });
  });

  it('ровно «сейчас» — тоже сегодня', () => {
    expect(nightBedtime(7 * 60, last, at(7))).toEqual({ day: '2026-03-10', minute: 420 });
  });

  it('раньше последней отметки не встаёт', () => {
    // Вечерняя отметка стоит на 1320-й минуте: до неё и на неё — мимо.
    expect(nightBedtime(1319, last, at(7))).toBeUndefined();
    expect(nightBedtime(1320, last, at(7))).toBeUndefined();
    expect(nightBedtime(1321, last, at(7))).toEqual({ day: '2026-03-09', minute: 1321 });
  });

  it('сегодняшняя последняя отметка запирает всё вчерашнее окно', () => {
    // Отметились в 01:00 и снова уснули: «легли в 23:00» теперь означало бы
    // позавчерашний вечер — такая отметка ничего не чинит.
    const night: LastShift = { day: '2026-03-10', minute: 60, level: 1 };
    expect(nightBedtime(1380, night, at(7))).toBeUndefined();
    expect(nightBedtime(90, night, at(7))).toEqual({ day: '2026-03-10', minute: 90 });
  });
});
