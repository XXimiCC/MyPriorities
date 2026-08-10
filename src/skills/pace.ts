/**
 * Темп навыка и прогноз следующей ступени.
 *
 * Накопленные часы отвечают на вопрос «где я», но не на вопрос «двигаюсь ли».
 * Раньше на второй отвечал переключатель периода, и отвечал плохо: он менял два
 * мелких числа и не трогал ни ступень, ни полосу, ни порядок строк — а на шкале
 * навыка за семь дней у большинства ноль, и переключатель выглядел неисправным.
 * Выбор окна убран, окно теперь одно на всех: тридцать дней. Недели мало —
 * одна поездка обнулила бы темп; квартал уже не про «сейчас».
 *
 * Прогноз линейный: сколько набралось за месяц, столько будет набираться и
 * дальше. Это заведомо грубо, поэтому срок округляется до дней, недель, месяцев
 * и лет — «через 4,3 месяца» обещало бы точность, которой здесь нет.
 */

import { count, t } from '../i18n';
import type { Progress } from './levels';

/** Окно темпа в днях. */
export const PACE_DAYS = 30;

const DAYS_IN_WEEK = 7;

/** Дальше этого срока прогноз не считается: там уже не темп, а случайность. */
const HORIZON_DAYS = 3650;

export interface Pace {
  /** Минуты, набранные за окно. */
  minutes: number;
  /** Минуты в неделю — в этом виде темп читается. */
  perWeek: number;
  /**
   * Дней до следующей ступени при этом темпе. undefined — считать нечего:
   * либо за месяц не набралось ничего, либо ступень последняя.
   */
  daysToNext?: number;
}

export function paceOf(recentMinutes: number, progress: Progress): Pace {
  const minutes = Number.isFinite(recentMinutes) ? Math.max(0, recentMinutes) : 0;
  const perDay = minutes / PACE_DAYS;
  const pace: Pace = { minutes, perWeek: perDay * DAYS_IN_WEEK };

  if (perDay > 0 && progress.next && progress.hoursToNext > 0) {
    pace.daysToNext = (progress.hoursToNext * 60) / perDay;
  }
  return pace;
}

/**
 * Срок словами. Единица укрупняется вместе со сроком: «5 дней», «3 недели»,
 * «7 месяцев», «2 года». Пустая строка означает, что говорить нечего.
 *
 * Границы подобраны так, чтобы недель никогда не вышло ровно одна: подпись
 * подставляется в «через {eta}», и «через 1 неделя» требовало бы винительного
 * падежа отдельной таблицей ради единственного числа, которое сюда не попадает.
 */
export function formatEta(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return '';
  if (days > HORIZON_DAYS) return t('skills.etaFar');
  if (days < 14) return count('day', Math.max(1, Math.round(days)));
  if (days < 60) return count('week', Math.round(days / DAYS_IN_WEEK));
  if (days < 730) return count('month', Math.round(days / 30));
  return count('year', Math.round(days / 365));
}
