import { useState } from 'react';

import { BlockTuner } from '../components/BlockTuner';
import { ColorPicker } from '../components/ColorPicker';
import { Sheet } from '../components/Sheet';
import { formatDayShort, formatHoursCompact, formatMinutes, parseDayKey, todayKey } from '../domain/date';
import { colorOf } from '../domain/palette';
import type { DayKey, Priority } from '../domain/types';
import { count, plural, t } from '../i18n';
import { LEVELS, levelTitle, rankTitle } from './levels';
import { formatEta, paceOf, PACE_DAYS } from './pace';
import { SkillHistory } from './SkillHistory';
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
  /** День, в который идёт запись: сегодня или выбранный в ленте на экране. */
  day: DayKey;
  /** Блоки навыка за этот день — их и правит счётчик наверху шторки. */
  dayBlocks: number;
  /** Сколько набрано за окно темпа — из этого считается прогноз ступени. */
  recentMinutes: number;
  /** Дни полосы истории и блоки по ним — от старых к новым. */
  historyDays: DayKey[];
  historyBlocks: number[];
  /** Приоритеты, к которым можно привязаться, с пометкой уже занятых. */
  targets: LinkTarget[];
  /** Название привязанного приоритета; undefined — привязки нет. */
  linkedTitle?: string;
  /** Привязанный приоритет уехал в архив: новое время идёт только в навык. */
  linkArchived: boolean;
  onClose(): void;
  onAdd(): void;
  onRemove(): void;
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
  blockMinutes,
  day,
  dayBlocks,
  recentMinutes,
  historyDays,
  historyBlocks,
  targets,
  linkedTitle,
  linkArchived,
  onAdd,
  onRemove,
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
  const [fullLadder, setFullLadder] = useState(false);
  const accent = colorOf(skill.colorId).hex;

  /*
   * Семнадцать ступеней разом — это экран, который надо пролистать, чтобы
   * добраться до настроек навыка. По умолчанию показываем окрестность текущей
   * ступени: назад одну, вперёд две — этого хватает, чтобы понять, где ты и
   * что дальше. Вся лестница разворачивается по кнопке.
   */
  const ladder = fullLadder
    ? LEVELS
    : LEVELS.slice(Math.max(0, progress.level.index - 1), progress.level.index + 3);

  const years = skill.startedOn
    ? Math.floor((Date.now() - parseDayKey(skill.startedOn).getTime()) / (365.25 * 864e5))
    : 0;

  /*
   * Темп и прогноз стоят сразу под «до следующей ступени»: порог сам по себе —
   * это просто большое число, и только вместе со сроком он говорит, далеко ли до
   * него на самом деле.
   */
  const pace = paceOf(recentMinutes, progress);
  const eta = pace.daysToNext === undefined ? '' : formatEta(pace.daysToNext);

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

        {pace.minutes > 0 ? (
          <small className="sksheet__pace">
            {t('skills.pace', { days: PACE_DAYS, time: formatHoursCompact(pace.perWeek) })}
            {eta && <>. {t('skills.eta', { eta })}</>}
          </small>
        ) : (
          <small className="sksheet__pace">{t('skills.paceNone', { days: PACE_DAYS })}</small>
        )}
      </div>

      {/* Тот же счётчик, что и у приоритета: промахнуться по «+» одинаково легко
          и там, и там, и способ исправиться должен быть один и тот же. */}
      <BlockTuner
        blocks={dayBlocks}
        blockMinutes={blockMinutes}
        caption={
          day === todayKey()
            ? t('home.todayBlocks', { count: dayBlocks, unit: plural('block', dayBlocks) })
            : t('home.dayBlocks', {
                count: dayBlocks,
                unit: plural('block', dayBlocks),
                day: formatDayShort(day),
              })
        }
        onAdd={onAdd}
        onRemove={onRemove}
      />

      {/* История стоит сразу за счётчиком, до лестницы: сначала «что было на
          этой неделе», и только потом «куда это ведёт через тысячу часов». */}
      <div className="divider-label">
        <span>{t('skills.historyTitle', { days: historyDays.length })}</span>
      </div>

      <SkillHistory
        days={historyDays}
        blocks={historyBlocks}
        blockMinutes={blockMinutes}
        detailed
      />

      <div className="divider-label">
        <span>{t('level.ladder')}</span>
      </div>

      <ol className="sksheet__ladder">
        {ladder.map((level) => {
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

      <button className="sksheet__more" type="button" onClick={() => setFullLadder(!fullLadder)}>
        {fullLadder ? t('level.collapse') : t('level.expand', { count: LEVELS.length })}
      </button>

      <div className="divider-label">
        <span>{t('skills.formTitle')}</span>
      </div>

      <input
        className="field"
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

      <ColorPicker value={skill.colorId} onChange={onRecolor} />

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
              <span className="swatch" />
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

      <button className="btn-danger sksheet__delete press" type="button" onClick={onDelete}>
        {t('skills.delete')}
      </button>
    </div>
  );
}
