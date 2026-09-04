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
  /**
   * Пришедшее с сервера поверх того, что уже на экране.
   *
   * Отдельно от `hydrate` по двум причинам. Первая: гидратация объявляет
   * приложение готовым и гасит всплывашку о новых достижениях — а обмен
   * случается в любой момент, в том числе пока она на экране. Вторая:
   * настройки и каталог приходят документами и могут не прийти вовсе, и
   * тогда на экране должно остаться своё, а не пустое.
   */
  | {
      type: 'synced';
      journal: Journal;
      skillClicks: ClicksMap;
      awards: AwardMap;
      settings?: Settings;
      skills?: SkillsState;
    }
  | { type: 'blocks'; day: DayKey; priorityId: string; delta: number }
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

/** Прибавляет блок в карту кликов. Форма общая у приоритетов и навыков. */
function bump(clicks: ClicksMap, day: DayKey, id: string, delta: number): ClicksMap {
  const entry = clicks[day] ?? {};
  const next = Math.max(0, (entry[id] ?? 0) + delta);
  const updatedDay = { ...entry };
  if (next > 0) updatedDay[id] = next;
  else delete updatedDay[id];

  const out = { ...clicks };
  if (Object.keys(updatedDay).length > 0) out[day] = updatedDay;
  else delete out[day];
  return out;
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

    case 'synced':
      return {
        ...state,
        journal: action.journal,
        skillClicks: action.skillClicks,
        awards: action.awards,
        settings: action.settings ?? state.settings,
        skills: action.skills ?? state.skills,
      };

    case 'blocks': {
      const clicks = bump(state.journal.clicks, action.day, action.priorityId, action.delta);
      return { ...state, journal: { ...state.journal, clicks } };
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
