/**
 * Что это устройство помнит про утренний вопрос о ночи.
 *
 * Локально и намеренно. Настройки едут документом на все устройства, а «я утром
 * отмахнулся» — событие этого телефона: планшет, открытый в обед, не должен
 * считать, что за него уже ответили. По той же причине здесь и время отхода ко
 * сну: это подсказка полю ввода, а не общая настройка.
 *
 * Лежит в `meta` локальной базы — там же, где сессия и идентификатор
 * устройства. Этот раздел не синхронизируется и не попадает в копию данных.
 */

import { clampMinute } from '../domain/battery';
import type { NightMemory } from '../domain/battery';
import { opsLog } from '../store/local/db';

const KEY = 'nightAsk';

export async function readNightMemory(): Promise<NightMemory> {
  try {
    const raw = await opsLog.meta(KEY);
    if (typeof raw !== 'object' || raw === null) return {};

    const value = raw as Partial<NightMemory>;
    return {
      askedOn: typeof value.askedOn === 'string' ? value.askedOn : undefined,
      bedtime: Number.isFinite(value.bedtime) ? clampMinute(value.bedtime as number) : undefined,
    };
  } catch (error) {
    // Не прочиталось — спросим ещё раз. Лишний вопрос дешевле пропущенной ночи.
    console.warn('[charge] отметка утреннего вопроса не прочиталась', error);
    return {};
  }
}

export async function writeNightMemory(memory: NightMemory): Promise<void> {
  try {
    await opsLog.setMeta(KEY, memory);
  } catch (error) {
    // Не записалась — вопрос вернётся после перезапуска. Данные от этого не страдают.
    console.warn('[charge] отметка утреннего вопроса не записалась', error);
  }
}
