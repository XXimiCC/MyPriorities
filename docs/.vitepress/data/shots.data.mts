/*
 * Список снимков — из настоящего манифеста tools/shots/scenarios.mjs.
 *
 * Переписанный руками, он разошёлся бы с манифестом на первом же добавленном
 * кадре. Здесь берутся только имя и подпись; функции setup не трогаются.
 */

import { RUNS } from '../../../tools/shots/scenarios.mjs';

export default {
  load() {
    const runs = RUNS.map((run) => ({
      id: run.id,
      url: run.url,
      shots: run.shots.map((shot) => ({
        name: shot.name,
        note: shot.note,
        tall: Boolean(shot.tall),
        cropped: Boolean(shot.target),
      })),
    }));

    // Заголовки прогонов на странице статические — иначе три v-for-заголовка
    // получили бы один якорь. Строки достаются по идентификатору прогона.
    const byRun = Object.fromEntries(runs.map((run) => [run.id, run.shots]));

    return { runs, byRun, total: runs.reduce((sum, run) => sum + run.shots.length, 0) };
  },
};
