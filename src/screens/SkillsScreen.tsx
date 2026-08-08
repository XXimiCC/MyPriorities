import { useMemo, useState } from 'react';

import { ColorPicker } from '../components/ColorPicker';
import { PeriodSwitch } from '../components/PeriodSwitch';
import { Sheet } from '../components/Sheet';
import { formatMinutes, todayKey } from '../domain/date';
import { colorOf, nextFreeColorId } from '../domain/palette';
import { periodDays } from '../domain/stats';
import { PERIODS, blockMinutesOf, type PeriodId } from '../domain/types';
import { plural, t } from '../i18n';
import { SkillRow } from '../skills/SkillRow';
import { SkillSheet, type LinkTarget } from '../skills/SkillSheet';
import { ALL_SUGGESTIONS, SKILL_SUGGESTIONS } from '../skills/catalogue';
import {
  skillBlocksIn,
  skillBlocksOn,
  skillTotals,
  targetOf,
  totalMinutes,
  type SkillContext,
} from '../skills/total';
import { MAX_SKILLS } from '../skills/types';
import { useStore } from '../store/useStore';
import { confirmDialog, haptics } from '../telegram/sdk';
import './SkillsScreen.css';

/** «Сегодня» здесь бессмысленно: навык меряется годами, а не сутками. */
const SKILL_PERIODS = PERIODS.filter((p) => p.id !== 'today');

export function SkillsScreen(): JSX.Element {
  const { settings, journal, skills, skillClicks, actions } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [periodId, setPeriodId] = useState<PeriodId>('month');

  const blockMinutes = blockMinutesOf(settings);
  const today = todayKey();

  const ctx: SkillContext = useMemo(
    () => ({ skillClicks, clicks: journal.clicks, blockMinutes }),
    [skillClicks, journal.clicks, blockMinutes],
  );

  const totals = useMemo(() => skillTotals(skills.skills, ctx), [skills.skills, ctx]);
  const period = SKILL_PERIODS.find((p) => p.id === periodId) ?? SKILL_PERIODS[0]!;

  // Окно периода строится по журналу приоритетов и навыков сразу: у привязанного
  // навыка время лежит в первом, у самостоятельного — во втором.
  const days = useMemo(
    () => periodDays(period, { clicks: { ...journal.clicks, ...skillClicks }, battery: {} }),
    [period, journal.clicks, skillClicks],
  );

  const inPeriod = useMemo(
    () => new Map(skills.skills.map((skill) => [skill.id, skillBlocksIn(skill, ctx, days)])),
    [skills.skills, ctx, days],
  );
  const periodBlocks = [...inPeriod.values()].reduce((sum, n) => sum + n, 0);

  const activeIds = useMemo(
    () => new Set(settings.priorities.map((p) => p.id)),
    [settings.priorities],
  );

  const open = totals.find((item) => item.skill.id === openId) ?? null;
  const openSkill = open?.skill;
  const linked = openSkill?.linkedPriorityId;
  const linkedPriority = linked
    ? settings.priorities.find((p) => p.id === linked) ?? settings.archived.find((p) => p.id === linked)
    : undefined;

  const targets: LinkTarget[] = useMemo(
    () =>
      settings.priorities.map((priority) => {
        const holder = skills.skills.find(
          (s) => s.linkedPriorityId === priority.id && s.id !== openId,
        );
        return holder ? { priority, heldBy: holder.title } : { priority };
      }),
    [settings.priorities, skills.skills, openId],
  );

  const taken = useMemo(
    () => new Set(skills.skills.map((s) => s.title.trim().toLowerCase())),
    [skills.skills],
  );

  const atLimit = skills.skills.length >= MAX_SKILLS;

  /** «+» у привязанного навыка уходит приоритету, иначе время считалось бы дважды. */
  const addBlock = (skillId: string): void => {
    const skill = skills.skills.find((s) => s.id === skillId);
    if (!skill) return;
    haptics.bump();
    const target = targetOf(skill, activeIds);
    if (target.kind === 'priority') actions.addBlock(target.id);
    else actions.addSkillBlock(skillId);
  };

  const link = (priorityId: string | undefined): void => {
    if (!openSkill) return;
    void (async () => {
      if (!priorityId) {
        if (!linkedPriority) return;
        const ok = await confirmDialog(
          t('skills.unlinkConfirm', {
            name: linkedPriority.title,
            time: formatMinutes(blocksOfPriority(ctx, linkedPriority.id) * blockMinutes),
          }),
        );
        if (!ok) return;
        actions.linkSkill(openSkill.id, undefined);
        return;
      }

      const priority = settings.priorities.find((p) => p.id === priorityId);
      if (!priority) return;
      const holder = targets.find((item) => item.priority.id === priorityId)?.heldBy;

      const ok = await confirmDialog(
        holder
          ? t('skills.relinkConfirm', { name: priority.title, skill: holder })
          : t('skills.linkConfirm', {
              name: priority.title,
              time: formatMinutes(blocksOfPriority(ctx, priorityId) * blockMinutes),
            }),
      );
      if (!ok) return;
      haptics.success();
      actions.linkSkill(openSkill.id, priorityId);
    })();
  };

  return (
    <>
      <header className="header">
        <h1 className="header__title">{t('skills.title')}</h1>
        <span className="sks__counter">
          {t('skills.counter', { count: skills.skills.length, max: MAX_SKILLS })}
        </span>
      </header>

      {totals.length > 0 && (
        <div className="app__sticky">
          <PeriodSwitch periods={SKILL_PERIODS} value={periodId} onChange={setPeriodId} />
        </div>
      )}

      <div className="app__body">
        {totals.length === 0 ? (
          <p className="empty">{t('skills.empty')}</p>
        ) : (
          <>
            <p className="sks__total">
              {t('skills.total', { time: formatMinutes(totalMinutes(totals)) })}
              <span>
                {t('skills.inPeriod', { time: formatMinutes(periodBlocks * blockMinutes) })}
              </span>
            </p>

            <ul className="sks__list">
              {totals.map((item) => (
                <SkillRow
                  key={item.skill.id}
                  total={item}
                  todayBlocks={skillBlocksOn(item.skill, ctx, today)}
                  periodMinutes={(inPeriod.get(item.skill.id) ?? 0) * blockMinutes}
                  blockMinutes={blockMinutes}
                  onAdd={() => addBlock(item.skill.id)}
                  onOpen={() => setOpenId(item.skill.id)}
                />
              ))}
            </ul>
            <p className="sks__hint">{t('skills.hint')}</p>
          </>
        )}

        <button
          className="edit__add press"
          type="button"
          disabled={atLimit}
          onClick={() => setAdding(true)}
        >
          {atLimit ? t('skills.limit', { max: MAX_SKILLS }) : t('skills.add')}
        </button>

        {skills.archived.length > 0 && (
          <>
            <div className="divider-label">
              <span>
                {t('skills.archiveTitle', {
                  count: skills.archived.length,
                  unit: plural('skill', skills.archived.length),
                })}
              </span>
            </div>
            <p className="sks__hint">{t('skills.archiveHint')}</p>
            <ul className="sks__archive">
              {skills.archived.map((skill) => (
                <li key={skill.id}>
                  {skill.title}
                  <span>{formatMinutes(skill.baseMinutes + skill.carryBlocks * blockMinutes)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <SkillSheet
        total={open}
        blockMinutes={blockMinutes}
        targets={targets}
        {...(linkedPriority ? { linkedTitle: linkedPriority.title } : {})}
        linkArchived={Boolean(linked) && !activeIds.has(linked!)}
        onClose={() => setOpenId(null)}
        onRename={(title) => openSkill && actions.updateSkill(openSkill.id, { title })}
        onRecolor={(colorId) => {
          haptics.select();
          if (openSkill) actions.updateSkill(openSkill.id, { colorId });
        }}
        onBase={(hours) => openSkill && actions.updateSkill(openSkill.id, { baseMinutes: hours * 60 })}
        onStarted={(day) => openSkill && actions.updateSkill(openSkill.id, { startedOn: day })}
        onLink={link}
        onDelete={() => {
          if (!openSkill) return;
          void (async () => {
            const ok = await confirmDialog(t('skills.deleteConfirm', { title: openSkill.title }));
            if (!ok) return;
            haptics.warning();
            actions.deleteSkill(openSkill.id);
            setOpenId(null);
          })();
        }}
      />

      <Sheet open={adding} title={t('skills.newTitle')} onClose={() => setAdding(false)}>
        {adding && (
          <AddSkillForm
            taken={taken}
            defaultColorId={nextFreeColorId(skills.skills.map((s) => s.colorId))}
            onAdd={(title, baseHours, colorId) => {
              // Шторка с настройками навыка после добавления не открывается:
              // это выглядело как вторая форма подряд, хотя всё уже заполнено.
              if (actions.addSkill({ title, baseHours, colorId })) haptics.success();
              setAdding(false);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function blocksOfPriority(ctx: SkillContext, id: string): number {
  let total = 0;
  for (const entry of Object.values(ctx.clicks)) {
    const value = entry[id];
    if (value !== undefined && value > 0) total += value;
  }
  return total;
}

function AddSkillForm({
  taken,
  defaultColorId,
  onAdd,
}: {
  taken: Set<string>;
  defaultColorId: number;
  onAdd(title: string, baseHours: number, colorId: number): void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [hours, setHours] = useState('');
  const [colorId, setColorId] = useState(defaultColorId);
  const [mode, setMode] = useState<'list' | 'own'>('list');
  const canSubmit = title.trim().length > 0;

  /*
   * Значение списка выводится из названия, а не хранится отдельно: выбор
   * подставляет название, а правка руками сама возвращает список к пустому.
   * Два состояния здесь неминуемо разъехались бы.
   */
  const picked = ALL_SUGGESTIONS.includes(title.trim()) ? title.trim() : '';

  return (
    <form
      className="pform"
      // Кнопка «Добавить» красится выбранным цветом — тем самым, которым навык
      // будет отмечен в списке. Без акцента её фон был бы прозрачным на чёрном.
      style={{ '--accent': colorOf(colorId).hex } as React.CSSProperties}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onAdd(title, Number(hours) || 0, colorId);
      }}
    >
      {/* Список и своё название не показываются вместе: два поля для одного и
          того же спорят за внимание, и непонятно, какое из них главное. */}
      <div className="pswitch" role="tablist" aria-label={t('skills.nameSource')}>
        {(['list', 'own'] as const).map((id) => (
          <button
            key={id}
            className="pswitch__item"
            role="tab"
            type="button"
            aria-selected={mode === id}
            onClick={() => {
              if (mode === id) return;
              haptics.select();
              setMode(id);
            }}
          >
            {t(id === 'list' ? 'skills.fromList' : 'skills.ownName')}
          </button>
        ))}
      </div>

      {mode === 'list' ? (
        /*
         * Родной select, а не свой список: внутри Telegram он открывается
         * системным колесом выбора, где разделы читаются с одного взгляда,
         * а полсотни вариантов не растягивают форму на несколько экранов.
         */
        <label className="sks__select">
          <select
            value={picked}
            onChange={(event) => {
              haptics.select();
              setTitle(event.target.value);
            }}
          >
            <option value="">{t('skills.pickPlaceholder')}</option>
            {SKILL_SUGGESTIONS.map((group) => (
              <optgroup key={group.title} label={group.title}>
                {group.titles.map((name) => (
                  <option key={name} value={name} disabled={taken.has(name.toLowerCase())}>
                    {name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path d="M6 10l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </label>
      ) : (
        <input
          className="pform__input"
          value={title}
          maxLength={24}
          autoComplete="off"
          placeholder={t('skills.placeholder')}
          onChange={(event) => setTitle(event.target.value)}
        />
      )}

      <ColorPicker value={colorId} onChange={setColorId} />

      <label className="sksheet__field">
        <span>{t('skills.baseLabel')}</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={100000}
          value={hours}
          placeholder="0"
          onChange={(event) => setHours(event.target.value)}
        />
      </label>
      <p className="sksheet__note">{t('skills.baseNote')}</p>

      <button className="pform__submit press" type="submit" disabled={!canSubmit}>
        {t('common.add')}
      </button>
    </form>
  );
}
