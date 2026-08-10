/**
 * Действие стора → операции журнала.
 *
 * Запись перехвачена в одной точке, а не расставлена по методам: методов
 * полтора десятка, они растут, и забытый вызов означал бы тихо потерянную
 * правку — то есть ровно ту болезнь, от которой журнал и лечит.
 *
 * Функция чистая: на вход состояние **до** действия, на выход операции. Ни
 * хранилища, ни часов внутри нет — метку выдаёт переданный `stamp`.
 */

import { sanitizeAwards, type AwardMap } from '../achievements/types';
import { clampMinute } from '../domain/battery';
import type { BatteryLevel, ClicksMap, DayKey, Journal } from '../domain/types';
import type { SnapshotContents } from '../domain/snapshot';
import {
  awardOp,
  batteryDeleteOp,
  batteryOp,
  blockOp,
  blockSetOp,
  clearOp,
  drainOp,
  skillBlockOp,
  skillBlockSetOp,
  unawardOp,
  type Op,
  type Stamper,
} from './ops';

/** Часть состояния, которой хватает, чтобы вычислить операции. */
export interface HistorySlice {
  journal: Journal;
  skillClicks: ClicksMap;
  awards: AwardMap;
}

/**
 * Действия, меняющие историю. Форма совпадает с действиями стора намеренно:
 * стор передаёт своё действие как есть, и расхождение формы стало бы ошибкой
 * компиляции.
 */
export type Recordable =
  | { type: 'blocks'; day: DayKey; priorityId: string; delta: number }
  | { type: 'skill-blocks'; day: DayKey; skillId: string; delta: number }
  | { type: 'battery-set'; day: DayKey; minute: number; level: BatteryLevel; replace?: number }
  | { type: 'battery-remove'; day: DayKey; minute: number }
  | { type: 'drain'; day: DayKey; drainedBy: string }
  | { type: 'awards'; awards: AwardMap };

/**
 * Полный список записываемых типов.
 *
 * Тип `Record<Recordable['type'], true>` делает таблицу исчерпывающей: новый вид
 * действия, забытый здесь, не соберётся.
 */
const RECORDABLE: Record<Recordable['type'], true> = {
  blocks: true,
  'skill-blocks': true,
  'battery-set': true,
  'battery-remove': true,
  drain: true,
  awards: true,
};

export function isRecordable(action: { type: string }): action is Recordable {
  return action.type in RECORDABLE;
}

/**
 * Слагаемое, которое действительно изменит счётчик.
 *
 * Счётчик в состоянии обрезан снизу нулём, и снятие блока с уже пустой ячейки
 * ничего не меняет. Записать при этом `−1` значило бы развести журнал с
 * состоянием: следующее добавление дало бы 1 в памяти и 0 в проекции.
 */
function effectiveDelta(clicks: ClicksMap, day: DayKey, id: string, delta: number): number {
  const current = clicks[day]?.[id] ?? 0;
  return Math.max(0, current + delta) - current;
}

export function recordOps(before: HistorySlice, action: Recordable, stamp: Stamper): Op[] {
  switch (action.type) {
    case 'blocks': {
      const delta = effectiveDelta(
        before.journal.clicks,
        action.day,
        action.priorityId,
        action.delta,
      );
      return delta === 0 ? [] : [blockOp(stamp, action.day, action.priorityId, delta)];
    }

    case 'skill-blocks': {
      const delta = effectiveDelta(before.skillClicks, action.day, action.skillId, action.delta);
      return delta === 0 ? [] : [skillBlockOp(stamp, action.day, action.skillId, delta)];
    }

    case 'battery-set': {
      /*
       * `setShift` в домене делает три вещи разом: убирает правимую отметку,
       * убирает совпавшую по минуте и ставит новую, перенося ответ о расходе,
       * если уровень остался «на нуле». В журнале это три разные операции.
       *
       * Надгробие перед установкой нужно из-за того, что уровень и ответ —
       * независимые ячейки: без него старый ответ пережил бы смену уровня,
       * хотя в состоянии он исчезает.
       */
      const existing = before.journal.battery[action.day] ?? [];
      const at = clampMinute(action.minute);
      const source =
        action.replace === undefined
          ? undefined
          : existing.find((shift) => shift[0] === action.replace);
      const carried = action.level === 1 ? source?.[2] : undefined;

      const ops: Op[] = [];
      if (source !== undefined && action.replace !== at) {
        ops.push(batteryDeleteOp(stamp, action.day, action.replace!));
      }
      if (existing.some((shift) => shift[0] === at)) {
        ops.push(batteryDeleteOp(stamp, action.day, at));
      }
      ops.push(batteryOp(stamp, action.day, at, action.level));
      if (carried) ops.push(drainOp(stamp, action.day, at, carried));
      return ops;
    }

    case 'battery-remove': {
      const existing = before.journal.battery[action.day] ?? [];
      if (!existing.some((shift) => shift[0] === action.minute)) return [];
      return [batteryDeleteOp(stamp, action.day, action.minute)];
    }

    case 'drain': {
      // День и минута ищутся ровно так же, как в reducer: ответ приписывается
      // последнему переходу, а если сегодня переходов нет — значит между
      // вопросом в 23:59 и ответом в 00:01 наступила полночь.
      const battery = before.journal.battery;
      const day = battery[action.day]?.length
        ? action.day
        : Object.keys(battery)
            .filter((key) => (battery[key]?.length ?? 0) > 0)
            .sort()
            .pop();
      if (day === undefined) return [];

      const shifts = battery[day];
      const last = shifts?.[shifts.length - 1];
      if (!last) return [];
      return [drainOp(stamp, day, last[0], action.drainedBy)];
    }

    case 'awards': {
      // Карта приходит целиком, поэтому разницу считаем здесь. Достижения
      // выдаются и снимаются поштучно, и журналу нужно именно это.
      const ops: Op[] = [];
      for (const [id, day] of Object.entries(action.awards)) {
        if (before.awards[id] !== day) ops.push(awardOp(stamp, id, day));
      }
      for (const id of Object.keys(before.awards)) {
        if (action.awards[id] === undefined) ops.push(unawardOp(stamp, id));
      }
      return ops;
    }
  }
}

/**
 * Состояние целиком в операции: барьер, а за ним итоги по каждой ячейке.
 *
 * Нужно там, где история заменяется, а не правится, — восстановление копии.
 * Итоги пишутся установкой (`blkset`), а не слагаемыми: повторный прогон
 * импорта не должен удваивать счётчики.
 *
 * Операций получается много — по одной на ячейку. Для локального журнала это
 * не беда, но отправлять их на сервер пачкой не стоит: там восстановление
 * копии правильнее выразить снимком, а не журналом.
 */
export function opsForContents(contents: SnapshotContents, stamp: Stamper): Op[] {
  const ops: Op[] = [clearOp(stamp)];

  for (const [day, entry] of Object.entries(contents.journal.clicks)) {
    for (const [id, count] of Object.entries(entry)) {
      if (count > 0) ops.push(blockSetOp(stamp, day, id, count));
    }
  }

  for (const [day, entry] of Object.entries(contents.skillClicks)) {
    for (const [id, count] of Object.entries(entry)) {
      if (count > 0) ops.push(skillBlockSetOp(stamp, day, id, count));
    }
  }

  for (const [day, shifts] of Object.entries(contents.journal.battery)) {
    for (const shift of shifts) {
      ops.push(batteryOp(stamp, day, shift[0], shift[1]));
      if (shift[2] !== undefined) ops.push(drainOp(stamp, day, shift[0], shift[2]));
    }
  }

  for (const [id, day] of Object.entries(sanitizeAwards({ g: contents.awards }))) {
    ops.push(awardOp(stamp, id, day));
  }

  return ops;
}

/**
 * Стирание истории. Достижения барьер не трогает, поэтому снятие автоматических
 * приезжает отдельными операциями — их выдаёт обычная запись действия `awards`.
 */
export function opsForClear(stamp: Stamper): Op[] {
  return [clearOp(stamp)];
}
