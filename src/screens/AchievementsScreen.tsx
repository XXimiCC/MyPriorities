import { useMemo, useState } from 'react';

import { formatDayFull } from '../domain/date';
import { modulesOf } from '../domain/types';
import { t } from '../i18n';
import { AchievementSheet } from '../achievements/AchievementSheet';
import { awardProgress } from '../achievements/evaluate';
import { accentOf, GROUP_ICONS } from '../achievements/icons';
import { noteOf, titleOf } from '../achievements/note';
import { ACHIEVEMENTS } from '../achievements/registry';
import { GROUPS, type Achievement, type GroupId } from '../achievements/types';
import { useStore } from '../store/useStore';
import './AchievementsScreen.css';

type Filter = 'all' | 'done' | 'locked';

const FILTERS: Array<{ id: Filter; labelKey: 'ach.filterAll' | 'ach.filterDone' | 'ach.filterLocked' }> = [
  { id: 'all', labelKey: 'ach.filterAll' },
  { id: 'done', labelKey: 'ach.filterDone' },
  { id: 'locked', labelKey: 'ach.filterLocked' },
];

export function AchievementsScreen(): JSX.Element {
  const { settings, awards, actions } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const skillsEnabled = modulesOf(settings).skills;
  const progress = awardProgress(awards, skillsEnabled);

  const visible = useMemo(
    () => ACHIEVEMENTS.filter((item) => item.needs !== 'skills' || skillsEnabled),
    [skillsEnabled],
  );

  const shown = useMemo(
    () =>
      visible.filter((item) => {
        const got = awards[item.id] !== undefined;
        return filter === 'all' || (filter === 'done' ? got : !got);
      }),
    [visible, awards, filter],
  );

  const byGroup = useMemo(() => {
    const map = new Map<GroupId, Achievement[]>();
    for (const item of shown) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return map;
  }, [shown]);

  const open = openId ? visible.find((item) => item.id === openId) ?? null : null;

  return (
    <>
      <header className="header">
        <h1 className="header__title">{t('ach.title')}</h1>
        <span className="ach__counter">{t('ach.progress', progress)}</span>
      </header>

      <div className="app__sticky">
        <div className="pswitch" role="tablist" aria-label={t('ach.title')}>
          {FILTERS.map((item) => (
            <button
              key={item.id}
              className="pswitch__item"
              role="tab"
              type="button"
              aria-selected={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="app__body">
        {shown.length === 0 && (
          <p className="empty">{filter === 'done' ? t('ach.emptyDone') : t('ach.emptyLocked')}</p>
        )}

        {GROUPS.filter((group) => byGroup.has(group)).map((group) => (
          <section key={group}>
            <div className="divider-label">
              <span>{t(`ach.g.${group}`)}</span>
            </div>
            <ul className="ach__grid">
              {(byGroup.get(group) ?? []).map((item) => {
                const day = awards[item.id];
                const color = accentOf(item.group);
                return (
                  <li key={item.id}>
                    <button
                      className={`ach__card press${day ? ' ach__card--on' : ''}`}
                      type="button"
                      style={{ '--accent': color.hex } as React.CSSProperties}
                      onClick={() => setOpenId(item.id)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        {GROUP_ICONS[item.group].map((d) => (
                          <path key={d} d={d} />
                        ))}
                      </svg>
                      <b>{titleOf(item)}</b>
                      <small>{day ? formatDayFull(day) : t('ach.locked')}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <p className="ach__legend">
          {t('ach.autoNote')} · {t('ach.deedNote')} · {t('ach.manualNote')}
        </p>
      </div>

      <AchievementSheet
        item={open}
        {...(open && awards[open.id] !== undefined ? { gotOn: awards[open.id]! } : {})}
        note={open ? noteOf(open) : ''}
        onClose={() => setOpenId(null)}
        onMark={() => open && actions.award(open.id)}
        onUnmark={() => open && actions.unaward(open.id)}
      />
    </>
  );
}
