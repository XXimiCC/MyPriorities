import { useState } from 'react';

import { Sheet } from '../components/Sheet';
import { formatHoursCompact, formatMinutes, parseDayKey } from '../domain/date';
import { NEON_PALETTE, colorOf } from '../domain/palette';
import type { Priority } from '../domain/types';
import { count, plural, t } from '../i18n';
import { LEVELS, levelTitle, rankTitle } from './levels';
import { formatNumber } from './SkillRow';
import type { SkillTotal } from './total';
import './SkillSheet.css';

export interface LinkTarget {
  priority: Priority;
  /** Навык, который держит этот приоритет сейчас, — его привязку придётся снять. */
  heldBy?: string;
}

interface Props {
  total: SkillTotal | null;
  blockMinutes: number;
  /** Приоритеты, к которым можно привязаться, с пометкой уже занятых. */
  targets: LinkTarget[];
  /** Название привязанного приоритета; undefined — привязки нет. */
  linkedTitle?: string;
  /** Привязанный приоритет уехал в архив: новое время идёт только в навык. */
  linkArchived: boolean;
  onClose(): void;
  onRename(title: string): void;
  onRecolor(colorId: number): void;
  onBase(hours: number): void;
  onStarted(day: string): void;
  onLink(priorityId: string | undefined): void;
  onDelete(): void;
}

export function SkillSheet(props: Props): JSX.Element {
  const { total, onClose } = props;
  return (
    <Sheet open={Boolean(total)} title={t('skills.formTitle')} onClose={onClose}>
      {/* key сбрасывает поля при смене навыка: без него в шторке остаётся предыдущий. */}
      {total && <SkillDetails key={total.skill.id} {...props} total={total} />}
    </Sheet>
  );
}

function SkillDetails({
  total,
  targets,
  linkedTitle,
  linkArchived,
  onRename,
  onRecolor,
  onBase,
  onStarted,
  onLink,
  onDelete,
}: Props & { total: SkillTotal }): JSX.Element {
  const { skill, progress } = total;
  const [title, setTitle] = useState(skill.title);
  const [baseHours, setBaseHours] = useState(
    skill.baseMinutes > 0 ? String(Math.round(skill.baseMinutes / 60)) : '',
  );
  const accent = colorOf(skill.colorId).hex;

  const years = skill.startedOn
    ? Math.floor((Date.now() - parseDayKey(skill.startedOn).getTime()) / (365.25 * 864e5))
    : 0;

  return (
    <div className="sksheet" style={{ '--accent': accent } as React.CSSProperties}>
      <div className="sksheet__now">
        <span className="sksheet__rank">{levelTitle(progress.level)}</span>
        <b className="sksheet__hours">{formatMinutes(progress.minutes)}</b>
        {progress.next ? (
          <small>
            {t('level.toNext', {
              name: levelTitle(progress.next),
              hours: formatNumber(Math.ceil(progress.hoursToNext)),
              unit: plural('hour', Math.ceil(progress.hoursToNext)),
            })}
          </small>
        ) : (
          <small>{t('level.top')}</small>
        )}
        {progress.nextRank && (
          <small>
            {t('level.toRank', {
              rank: rankTitle(progress.nextRank.rank),
              hours: formatNumber(Math.ceil(progress.hoursToNextRank)),
              unit: plural('hour', Math.ceil(progress.hoursToNextRank)),
            })}
          </small>
        )}
        {skill.startedOn && years > 0 && (
          <small>{t('skills.startedYears', { years, unit: plural('year', years) })}</small>
        )}
      </div>

      <div className="divider-label">
        <span>{t('level.ladder')}</span>
      </div>

      <ol className="sksheet__ladder">
        {LEVELS.map((level) => {
          const reached = level.index <= progress.level.index;
          const current = level.index === progress.level.index;
          return (
            <li
              key={level.index}
              className={`sksheet__step${reached ? ' sksheet__step--done' : ''}${current ? ' sksheet__step--now' : ''}`}
            >
              <span className="sksheet__step-name">{levelTitle(level)}</span>
              <span className="sksheet__step-hours">
                {level.hours === 0 ? '—' : `${formatNumber(level.hours)} ч`}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="divider-label">
        <span>{t('skills.formTitle')}</span>
      </div>

      <input
        className="pform__input"
        value={title}
        maxLength={24}
        autoComplete="off"
        placeholder={t('skills.placeholder')}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => {
          const trimmed = title.trim();
          if (trimmed && trimmed !== skill.title) onRename(trimmed);
        }}
      />

      <div className="picker">
        {NEON_PALETTE.map((color, index) => (
          <button
            key={color.hex}
            type="button"
            className={`picker__dot${index === skill.colorId ? ' picker__dot--on' : ''}`}
            style={{ '--accent': color.hex } as React.CSSProperties}
            aria-label={color.name}
            aria-pressed={index === skill.colorId}
            onClick={() => onRecolor(index)}
          />
        ))}
      </div>

      <label className="sksheet__field">
        <span>{t('skills.baseLabel')}</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={100000}
          value={baseHours}
          placeholder="0"
          onChange={(event) => setBaseHours(event.target.value)}
          onBlur={() => {
            const hours = Number(baseHours);
            const next = Number.isFinite(hours) && hours > 0 ? Math.round(hours) : 0;
            if (next * 60 !== skill.baseMinutes) onBase(next);
          }}
        />
      </label>
      <p className="sksheet__note">{t('skills.baseNote')}</p>

      <label className="sksheet__field">
        <span>{t('skills.startedLabel')}</span>
        <input
          type="date"
          value={skill.startedOn ?? ''}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(event) => onStarted(event.target.value)}
        />
      </label>
      <p className="sksheet__note">{t('skills.startedNote')}</p>

      <div className="divider-label">
        <span>{t('skills.linkTitle')}</span>
      </div>

      <p className="sksheet__note">{t('skills.linkNote')}</p>
      {linkedTitle && <p className="sksheet__linked">{t('skills.linkedTo', { name: linkedTitle })}</p>}
      {linkArchived && <p className="sksheet__note sksheet__warn">{t('skills.linkArchived')}</p>}

      <ul className="sksheet__links">
        <li>
          <button
            type="button"
            className={`sksheet__link${skill.linkedPriorityId ? '' : ' sksheet__link--on'}`}
            onClick={() => onLink(undefined)}
          >
            <span>{t('skills.linkNone')}</span>
          </button>
        </li>
        {targets.map(({ priority, heldBy }) => (
          <li key={priority.id}>
            <button
              type="button"
              className={`sksheet__link${priority.id === skill.linkedPriorityId ? ' sksheet__link--on' : ''}`}
              style={{ '--accent': colorOf(priority.colorId).hex } as React.CSSProperties}
              onClick={() => onLink(priority.id)}
            >
              <span className="erow__swatch" />
              <span>{priority.title}</span>
              {heldBy && <small>{t('skills.linkTaken', { skill: heldBy })}</small>}
            </button>
          </li>
        ))}
      </ul>

      <p className="sksheet__note">
        {t('skills.priceNote', { minutes: blockMinutes, unit: plural('minute', blockMinutes) })}
        {total.blocks > 0 && ` ${count('block', total.blocks)} — ${formatHoursCompact(total.blocks * blockMinutes)}.`}
      </p>

      <button className="sksheet__delete press" type="button" onClick={onDelete}>
        {t('skills.delete')}
      </button>
    </div>
  );
}
