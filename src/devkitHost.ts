/**
 * Диагностический снимок состояния для панели отладки.
 *
 * ГЛАВНОЕ ПРАВИЛО, и оно записано здесь один раз: отсюда уходят только числа,
 * булевы значения и перечисления. Ни названий приоритетов, ни имён навыков, ни
 * заметок — никогда. «Семь приоритетов» помогает починить баг ровно так же, как
 * «Терапия, Спорт, Работа…», а стоит несравнимо меньше.
 *
 * Правило дублируется машинной проверкой на выходе (devkit/redact.ts): к
 * соблюдению глазами возвращаться нельзя — достаточно, чтобы кто-то однажды
 * добавил сюда одно удобное поле.
 *
 * Модульная ячейка, а не контекст: панель живёт в отдельном корне React
 * намеренно, чтобы пережить падение этого дерева, и до контекста ей не
 * дотянуться. Тот же приём, что и readCurrentRoute в App.tsx.
 */

import { revealDevkit } from './devkit';
import type { State } from './store/reduce';
import { syncState } from './sync/auth';

/**
 * Позвать панель отладки из интерфейса.
 *
 * Обёртка, а не прямой импорт из экрана: весь клей с панелью собран в двух
 * файлах — здесь и в main.tsx, — и это проверяет tools/deps.test.ts. Убрать
 * панель из проекта должно быть правкой в известных местах, а не поиском по
 * всему src/.
 */
export { revealDevkit };

let snapshot: Record<string, unknown> = {};

export function writeDiagnosticSnapshot(state: State): void {
  const enabled = Object.entries(state.settings.modules)
    .filter(([, on]) => on)
    .map(([name]) => name);

  snapshot = {
    ready: state.ready,
    onboarded: state.settings.onboarded,
    priorities: state.settings.priorities.length,
    archived: state.settings.archived.length,
    // Идентификатор набора, а не его название: по нему находится файл пресета.
    preset: state.settings.presetId ?? null,
    blockMinutes: state.settings.blockMinutes,
    modules: enabled,
    clickDays: Object.keys(state.journal.clicks).length,
    batteryDays: Object.keys(state.journal.battery).length,
    skills: state.skills.skills.length,
    skillsArchived: state.skills.archived.length,
    skillsLoaded: state.skillsLoaded,
    awards: Object.keys(state.awards).length,
  };
}

export function readDiagnosticSnapshot(): Record<string, unknown> {
  // Состояние обмена спрашивается в момент жалобы, а не в момент записи: оно
  // меняется чаще всего остального, и устаревшее здесь было бы вредно.
  return { ...snapshot, sync: syncState().kind };
}
