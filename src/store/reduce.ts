/**
 * Состояние стора и переходы между ними.
 *
 * Вынесено из `useStore.tsx` не ради размера файла, а ради проверяемости:
 * функция чистая, а вокруг неё в сторе живут React, хранилище и сеть. Отдельно
 * её можно прогнать рядом с проекцией журнала и убедиться, что обе считают
 * одно и то же — а это и есть главное условие двойной записи.
 */

import { removeShift, setShift } from '../domain/battery';
import type { AwardMap } from '../achievements/types';
import type {
  BatteryLevel,
  BatteryShift,
  ClicksMap,
  DayKey,
  Journal,
  MarkTime,
  Settings,
} from '../domain/types';
import type { SkillsState } from '../skills/types';

export interface State {
  ready: boolean;
  settings: Settings;
  journal: Journal;
  skills: SkillsState;
  skillClicks: ClicksMap;
  awards: AwardMap;
  /** Только что открытые достижения — для всплывашки. В хранилище не едет. */
  fresh: string[];
  /**
   * Месяцы навыков прочитаны. Пока false, писать их запрещено: иначе включение
   * модуля тумблером записало бы пустую карту поверх облачной истории.
   */
  skillsLoaded: boolean;
}

export type Hydration = Omit<State, 'ready' | 'fresh'>;

export type Action =
  | ({ type: 'hydrate' } & Hydration)
  /** `minute` — время нажатия; его нет у записи в прошедший день. */
  | { type: 'blocks'; day: DayKey; priorityId: string; delta: number; minute?: number }
  | { type: 'battery-set'; day: DayKey; minute: number; level: BatteryLevel; replace?: number }
  | { type: 'battery-remove'; day: DayKey; minute: number }
  | { type: 'drain'; day: DayKey; drainedBy: string }
  | { type: 'settings'; settings: Settings }
  | { type: 'journal'; journal: Journal }
  | { type: 'skills'; skills: SkillsState }
  | { type: 'skill-blocks'; day: DayKey; skillId: string; delta: number }
  | { type: 'skill-journal'; skillClicks: ClicksMap; skillsLoaded: boolean }
  | { type: 'awards'; awards: AwardMap; fresh: string[] }
  | { type: 'dismiss-fresh' };

/**
 * Кладёт значение в ячейку карты «день → id». Пустая ячейка выкидывается вместе
 * с опустевшим днём: иначе день остаётся в журнале пустым ключом и попадает в
 * расчёты как день «с отметками».
 */
function put<T>(
  map: Record<DayKey, Record<string, T>>,
  day: DayKey,
  id: string,
  value: T | undefined,
): Record<DayKey, Record<string, T>> {
  const entry = { ...(map[day] ?? {}) };
  if (value === undefined) delete entry[id];
  else entry[id] = value;

  const out = { ...map };
  if (Object.keys(entry).length > 0) out[day] = entry;
  else delete out[day];
  return out;
}

/** Прибавляет блок в карту кликов. Форма общая у приоритетов и навыков. */
function bump(clicks: ClicksMap, day: DayKey, id: string, delta: number): ClicksMap {
  const next = Math.max(0, (clicks[day]?.[id] ?? 0) + delta);
  return put(clicks, day, id, next > 0 ? next : undefined);
}

/**
 * Стек отметок после правки: `+n` кладёт n в конец, `−n` снимает n с конца.
 *
 * Те же правила, что у `applyDelta` в проекции, и это не совпадение: живое
 * нажатие и воспроизведение журнала обязаны давать один и тот же стек, иначе
 * «−» снимало бы разные отметки до и после перезагрузки.
 */
function nextStack(stack: readonly MarkTime[], delta: number, minute?: number): MarkTime[] {
  if (delta < 0) return stack.slice(0, Math.max(0, stack.length + delta));
  const at: MarkTime = minute === undefined ? null : minute;
  return [...stack, ...new Array<MarkTime>(Math.max(0, delta)).fill(at)];
}

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'hydrate':
      return {
        ready: true,
        fresh: [],
        settings: action.settings,
        journal: action.journal,
        skills: action.skills,
        skillClicks: action.skillClicks,
        awards: action.awards,
        skillsLoaded: action.skillsLoaded,
      };

    case 'blocks': {
      /*
       * Счётчик берётся длиной стека, а не своим слагаемым.
       *
       * Так они не могут разойтись даже теоретически, а расхождение здесь стоит
       * дорого: «−» снимает последнюю отметку стека, и лишний блок в счётчике
       * означал бы, что снимается не та.
       */
      const stack = nextStack(
        state.journal.marks[action.day]?.[action.priorityId] ?? [],
        action.delta,
        action.minute,
      );
      const marks = put(
        state.journal.marks,
        action.day,
        action.priorityId,
        stack.length > 0 ? stack : undefined,
      );
      const clicks = put(
        state.journal.clicks,
        action.day,
        action.priorityId,
        stack.length > 0 ? stack.length : undefined,
      );
      return { ...state, journal: { ...state.journal, clicks, marks } };
    }

    case 'skill-blocks':
      return {
        ...state,
        skillClicks: bump(state.skillClicks, action.day, action.skillId, action.delta),
      };

    case 'skills':
      return { ...state, skills: action.skills };

    case 'skill-journal':
      return { ...state, skillClicks: action.skillClicks, skillsLoaded: action.skillsLoaded };

    case 'awards':
      return { ...state, awards: action.awards, fresh: action.fresh };

    case 'dismiss-fresh':
      return state.fresh.length === 0 ? state : { ...state, fresh: [] };

    case 'battery-set': {
      const existing = state.journal.battery[action.day] ?? [];
      const shifts = setShift(existing, action.minute, action.level, action.replace);
      return {
        ...state,
        journal: { ...state.journal, battery: { ...state.journal.battery, [action.day]: shifts } },
      };
    }

    case 'battery-remove': {
      const existing = state.journal.battery[action.day];
      if (!existing) return state;
      const shifts = removeShift(existing, action.minute);

      const battery = { ...state.journal.battery };
      // Опустевший день выкидываем целиком: иначе он остаётся в журнале пустым
      // ключом и попадает в расчёты как день «с отметками».
      if (shifts.length > 0) battery[action.day] = shifts;
      else delete battery[action.day];

      return { ...state, journal: { ...state.journal, battery } };
    }

    case 'drain': {
      // Ответ приписывается последнему переходу дня — тому самому, который
      // только что перевёл заряд на «на нуле» и вызвал вопрос.
      //
      // Если в этом дне переходов нет, значит между переходом и ответом наступила
      // полночь: вопрос задан вчера в 23:59, отвечают сегодня в 00:01. Ищем день
      // последнего перехода, иначе ответ пропадал бы молча.
      const day = state.journal.battery[action.day]?.length
        ? action.day
        : Object.keys(state.journal.battery)
            .filter((key) => (state.journal.battery[key]?.length ?? 0) > 0)
            .sort()
            .pop();
      if (day === undefined) return state;

      const shifts = state.journal.battery[day];
      const last = shifts?.[shifts.length - 1];
      if (!shifts || !last) return state;

      const updated: BatteryShift[] = [
        ...shifts.slice(0, -1),
        [last[0], last[1], action.drainedBy],
      ];
      return {
        ...state,
        journal: { ...state.journal, battery: { ...state.journal.battery, [day]: updated } },
      };
    }

    case 'settings':
      return { ...state, settings: action.settings };

    case 'journal':
      return { ...state, journal: action.journal };

    default:
      return state;
  }
}
