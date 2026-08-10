/**
 * Выдача достижений.
 *
 * Автоматические — липкие: раз выданные, они не снимаются, даже если условие
 * снова стало ложным. Иначе «за тридцать дней доля лидера не выше сорока
 * процентов» мигало бы туда-сюда каждый день вместе со скользящим окном, а
 * трофей, который отбирают, трофеем быть перестаёт.
 *
 * Снять их может только «стереть историю»: там исчезают данные, из которых они
 * были выведены. Отметки о жизни и ритуалы приложения переживают и это — они не
 * производные, а факты.
 */

import type { DayKey } from '../domain/types';
import type { AwardMap } from './types';
import { ACHIEVEMENTS, BY_ID } from './registry';
import type { AchievementContext } from './types';

export interface Evaluation {
  awards: AwardMap;
  /** Только что открытые — для всплывашки. Пусто, если ничего не изменилось. */
  fresh: string[];
}

export interface EvaluateOptions {
  /** Выключенный модуль навыков не должен раздавать достижения за навыки. */
  skillsEnabled: boolean;
  today: DayKey;
}

export function evaluate(
  awards: AwardMap,
  ctx: AchievementContext,
  options: EvaluateOptions,
): Evaluation {
  const fresh: string[] = [];
  let next: AwardMap | undefined;

  for (const item of ACHIEVEMENTS) {
    if (item.kind !== 'auto' || !item.test) continue;
    if (awards[item.id] !== undefined) continue;
    if (item.needs === 'skills' && !options.skillsEnabled) continue;
    if (!item.test(ctx)) continue;

    next ??= { ...awards };
    next[item.id] = options.today;
    fresh.push(item.id);
  }

  // Ссылка не меняется, если ничего не выдано: на неё завязан эффект-наблюдатель,
  // и новый объект на каждом прогоне гонял бы запись в хранилище вхолостую.
  return { awards: next ?? awards, fresh };
}

/**
 * Снимает автоматические достижения, оставляя отмеченные руками и выданные за
 * действия. Нужно при стирании истории: данных, из которых они выведены, больше
 * нет, и трофей за них был бы неправдой.
 *
 * Неизвестные идентификаторы сохраняются: это достижение из будущей версии,
 * прилетевшее из облака, и стирать его на старом клиенте нельзя.
 */
export function stripAuto(awards: AwardMap): AwardMap {
  const out: AwardMap = {};
  for (const [id, day] of Object.entries(awards)) {
    if (BY_ID.get(id)?.kind === 'auto') continue;
    out[id] = day;
  }
  return out;
}

/** Сколько достижений доступно и сколько открыто — для строки «12 из 74». */
export function awardProgress(
  awards: AwardMap,
  skillsEnabled: boolean,
): { done: number; total: number } {
  const visible = ACHIEVEMENTS.filter((item) => item.needs !== 'skills' || skillsEnabled);
  return {
    done: visible.filter((item) => awards[item.id] !== undefined).length,
    total: visible.length,
  };
}
