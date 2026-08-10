/**
 * Доливка: чего на сервере не хватает по сравнению с этим устройством.
 *
 * Появилось после потери данных на живом устройстве, и причина стоит того,
 * чтобы её записать.
 *
 * Переход на сервер раньше работал так: пусто на сервере — отправляем своё,
 * не пусто — забираем чужое и живём им. Второе и было ошибкой. История
 * устройства до переезда лежит не в журнале операций, а в прежнем хранилище,
 * и в проекции её нет. «Забрать чужое» для такого устройства означает не
 * «догнать остальных», а «выбросить свои годы и остаться с чужим хвостом».
 *
 * Хуже того, устройство само себе портило условие: одно нажатие до первого
 * удачного перехода уезжало на сервер отдельной операцией, и на следующем
 * запуске сервер уже был «не пуст» — своей же собственной единственной
 * операцией.
 *
 * Отсюда правило, которое здесь и живёт: **переход не стирает ничего и ни у
 * кого**. Вместо выбора «чьё главнее» считается разница, и на сервер уходит
 * только то, чего там нет. Барьера `clear` тут нет намеренно — он отменил бы
 * историю других устройств, а у них она своя: CloudStorage никогда не работал,
 * и каждое устройство копило отдельно.
 *
 * Правила разницы:
 *
 * - счётчики — по большему: установка идёт, только если здесь число больше;
 *   чужое большее значение остаётся нетронутым;
 * - заряд — по пустой минуте: занятую минуту не трогаем, у неё свой автор;
 * - достижения — по отсутствующим: снятое где-то не воскрешаем.
 *
 * Всё это идемпотентно: второй прогон на том же состоянии не даёт ни одной
 * операции. Именно поэтому доливкой безопасно чинить и переход, и
 * восстановление копии.
 */

import { sanitizeAwards } from '../achievements/types';
import type { SnapshotContents } from '../domain/snapshot';
import type { ClicksMap, DayKey } from '../domain/types';
import {
  awardOp,
  batteryOp,
  blockSetOp,
  drainOp,
  skillBlockSetOp,
  type Op,
  type Stamper,
} from './ops';
import type { Projected } from './project';

type SetOp = (stamp: Stamper, day: DayKey, id: string, total: number) => Op;

function fillCounters(mine: ClicksMap, theirs: ClicksMap, make: SetOp, stamp: Stamper): Op[] {
  const ops: Op[] = [];
  for (const [day, entry] of Object.entries(mine)) {
    for (const [id, count] of Object.entries(entry)) {
      if (count > 0 && count > (theirs[day]?.[id] ?? 0)) ops.push(make(stamp, day, id, count));
    }
  }
  return ops;
}

/**
 * Операции, после которых на сервере будет не меньше, чем здесь.
 *
 * `have` — то, что уже есть в общей проекции (снимки плюс журнал), `want` —
 * состояние этого устройства целиком. Пустой ответ означает, что доливать
 * нечего: всё здешнее уже там.
 */
export function opsToFill(want: SnapshotContents, have: Projected, stamp: Stamper): Op[] {
  const ops: Op[] = [
    ...fillCounters(want.journal.clicks, have.journal.clicks, blockSetOp, stamp),
    ...fillCounters(want.skillClicks, have.skillClicks, skillBlockSetOp, stamp),
  ];

  for (const [day, shifts] of Object.entries(want.journal.battery)) {
    // Минута занята — значит, переход в ней уже кем-то описан, и своим мы бы
    // только затёрли чужой ответ о расходе.
    const taken = new Set((have.journal.battery[day] ?? []).map((shift) => shift[0]));
    for (const shift of shifts) {
      if (taken.has(shift[0])) continue;
      ops.push(batteryOp(stamp, day, shift[0], shift[1]));
      if (shift[2] !== undefined) ops.push(drainOp(stamp, day, shift[0], shift[2]));
    }
  }

  for (const [id, day] of Object.entries(sanitizeAwards({ g: want.awards }))) {
    if (have.awards[id] === undefined) ops.push(awardOp(stamp, id, day));
  }

  return ops;
}
