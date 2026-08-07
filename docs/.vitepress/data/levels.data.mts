/*
 * Лестница навыков — из src/skills/levels.ts.
 *
 * Семнадцать порогов в markdown устарели бы при первой же правке шкалы, а
 * заметить это было бы некому: таблица выглядит правдоподобно с любыми числами.
 */

import { LEVELS, levelTitle, rankTitle, type RankId } from '../../../src/skills/levels';

export default {
  load() {
    const ranks: RankId[] = ['none', 'novice', 'skilled', 'expert', 'master'];

    return {
      count: LEVELS.length,
      ranks: ranks.map((rank) => ({
        id: rank,
        title: rankTitle(rank),
        steps: LEVELS.filter((level) => level.rank === rank).map((level) => ({
          index: level.index,
          title: levelTitle(level),
          hours: level.hours,
          // Пятизначные пороги без разделителя читаются как случайный набор цифр.
          hoursLabel: level.hours >= 10_000 ? level.hours.toLocaleString('ru-RU') : String(level.hours),
        })),
      })),
    };
  },
};
