import { useEffect, useMemo, useRef } from 'react';

import { todayKey } from '../domain/date';
import { blockMinutesOf, modulesOf } from '../domain/types';
import { skillTotals } from '../skills/total';
import { useStore } from '../store/useStore';
import { haptics } from '../telegram/sdk';
import { derive } from './derive';
import { evaluate } from './evaluate';

/** Та же пауза, что и у записи в хранилище: проверять чаще, чем пишем, незачем. */
const CHECK_DELAY_MS = 700;

/**
 * Невидимый наблюдатель: пересчитывает автоматические достижения после того,
 * как данные перестали меняться. Живёт отдельным компонентом, чтобы доменная
 * логика не переехала в стор, и не подписан на сами достижения — иначе выдача
 * запускала бы новую проверку по кругу.
 */
export function Watcher(): null {
  const { ready, settings, journal, skills, skillClicks, awards, actions } = useStore();
  const modules = modulesOf(settings);

  // Карта достижений и действия берутся в момент срабатывания, а не в момент
  // подписки: иначе таймер держал бы устаревшее замыкание. В зависимостях
  // эффекта их нет намеренно — выдача не должна запускать новую проверку.
  const latest = useRef({ actions, awards });
  latest.current = { actions, awards };

  const enabled = ready && modules.achievements;
  const skillsEnabled = modules.skills;

  const blockMinutes = blockMinutesOf(settings);
  const totals = useMemo(
    () =>
      skillsEnabled
        ? skillTotals(skills.skills, { skillClicks, clicks: journal.clicks, blockMinutes })
        : [],
    [skillsEnabled, skills.skills, skillClicks, journal.clicks, blockMinutes],
  );

  useEffect(() => {
    if (!enabled) return undefined;

    const timer = window.setTimeout(() => {
      const now = new Date();
      const ctx = {
        settings,
        journal,
        skills: totals,
        derived: derive(settings, journal, now),
        now,
      };
      const result = evaluate(latest.current.awards, ctx, {
        skillsEnabled,
        today: todayKey(now),
      });
      if (result.fresh.length === 0) return;

      haptics.success();
      latest.current.actions.applyAwards(result.awards, result.fresh);
    }, CHECK_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [enabled, skillsEnabled, settings, journal, totals]);

  return null;
}
