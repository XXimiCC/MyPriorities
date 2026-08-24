import { useEffect, useMemo, useRef, useState } from 'react';

import { ColorPicker } from '../components/ColorPicker';
import { BACK_DAYS, DayPicker, DayPickerToggle, PastDayNotice } from '../components/DayPicker';
import { HeaderBattery } from '../components/HeaderBattery';
import { Sheet } from '../components/Sheet';
import { formatMinutes, lastNDays, parseDayKey } from '../domain/date';
import { colorOf, nextFreeColorId } from '../domain/palette';
import { blockMinutesOf, type DayKey } from '../domain/types';
import { plural, t } from '../i18n';
import { Hours } from '../skills/Hours';
import { SkillRow } from '../skills/SkillRow';
import { SkillSheet, type LinkTarget } from '../skills/SkillSheet';
import { SkillsEmpty } from '../skills/SkillsEmpty';
import { allSuggestions, SKILL_SUGGESTIONS } from '../skills/catalogue';
import { PACE_DAYS } from '../skills/pace';
import {
  skillBlocksByDay,
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

export function SkillsScreen(): JSX.Element {
  const { settings, journal, skills, skillClicks, today, actions } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /**
   * День, в который идут клики, — та же механика, что на главной. Живёт в
   * состоянии экрана, а не в сторе, и потому сбрасывается на сегодня при каждом
   * открытии приложения: забыть, что пишешь во вчера, — главный риск режима.
   */
  const [writeDay, setWriteDay] = useState<DayKey>(today);
  const [pickerOpen, setPickerOpen] = useState(false);

  const blockMinutes = blockMinutesOf(settings);

  // Наступила полночь при открытом приложении — переводим запись на новые сутки.
  const lastToday = useRef(today);
  useEffect(() => {
    if (lastToday.current === today) return;
    lastToday.current = today;
    setWriteDay(today);
    setPickerOpen(false);
  }, [today]);

  const inPast = writeDay !== today;

  const ctx: SkillContext = useMemo(
    () => ({ skillClicks, clicks: journal.clicks, blockMinutes }),
    [skillClicks, journal.clicks, blockMinutes],
  );

  const totals = useMemo(() => skillTotals(skills.skills, ctx), [skills.skills, ctx]);

  /*
   * Окно темпа. Оно одно на весь экран и не выбирается: переключатель периода
   * убран, потому что менял два мелких числа и не трогал ни ступень, ни полосу.
   * Вместо выбора окна — прогноз в шторке, который отвечает на тот же вопрос
   * «двигаюсь ли», но по существу. Подробности — в src/skills/pace.ts.
   */
  const recentDays = useMemo(() => lastNDays(PACE_DAYS, parseDayKey(today)), [today]);

  const recentMinutes = useMemo(
    () =>
      new Map(
        skills.skills.map((skill) => [skill.id, skillBlocksIn(skill, ctx, recentDays) * blockMinutes]),
      ),
    [skills.skills, ctx, recentDays, blockMinutes],
  );
  const recentTotal = [...recentMinutes.values()].reduce((sum, n) => sum + n, 0);

  /*
   * История по дням — хвост того же окна, а не отдельный отсчёт: два окна с
   * разными краями рано или поздно разошлись бы на день. Глубина берётся у
   * ленты дописывания: в полосе видно ровно те дни, которые ещё можно закрыть.
   */
  const historyDays = useMemo(() => recentDays.slice(-BACK_DAYS), [recentDays]);

  const historyBlocks = useMemo(
    () => new Map(skills.skills.map((skill) => [skill.id, skillBlocksByDay(skill, ctx, historyDays)])),
    [skills.skills, ctx, historyDays],
  );

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
    if (target.kind === 'priority') actions.addBlock(target.id, writeDay);
    else actions.addSkillBlock(skillId, writeDay);
    // Запись в прошлый день из журнала не восстановить: клик за вчера выглядит
    // там ровно как сделанный вчера. Достижение то же, что и на главной.
    if (inPast) actions.award('r8');
  };

  /**
   * «−» снимает блок оттуда же, куда его положил «+». У привязанного навыка это
   * приоритет — и на главной он тоже станет на блок меньше, что честно: время
   * там и там одно. Запасной путь нужен для навыка, который копил сам и получил
   * привязку позже: собственные блоки этого дня у него никуда не делись.
   *
   * Проверяется именно выбранный день, а не сегодня: в режиме прошлого дня «−»
   * иначе смотрел бы в один журнал, а списывал из другого.
   */
  const removeBlock = (skillId: string): void => {
    const skill = skills.skills.find((s) => s.id === skillId);
    if (!skill) return;
    const target = targetOf(skill, activeIds);
    const fromPriority =
      target.kind === 'priority' && (journal.clicks[writeDay]?.[target.id] ?? 0) > 0;
    if (fromPriority && target.kind === 'priority') actions.removeBlock(target.id, writeDay);
    else actions.removeSkillBlock(skillId, writeDay);
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
        {/* Счётчика «сколько из скольких» здесь нет: предел в двадцать четыре
            навыка не тот повод, чтобы держать цифру на виду каждый день. Про
            него говорит сама кнопка, когда упереться в него действительно
            получилось. */}
        <div className="header__actions">
          <HeaderBattery />
        </div>
      </header>

      {totals.length > 0 && (
        <div className="app__sticky">
          {/* Итог и кнопка записи в прошлый день в одной строке — как на главной:
              место у кнопки одно и то же и под «Дописать», и под «Свернуть». */}
          <div className="sks__head">
            {/* Часы, а не «часы и минуты»: в сумме за жизнь получаются тысячи,
                и хвост «30 м» там не значит ничего, зато ломает строку надвое.
                Строки навыков считают в тех же единицах. */}
            {/* Две строки, а не одна: «Всего — 23,5 ч за 30 дней — 21,5 ч»
                читалось как два числа подряд без связи между ними. */}
            <p className="sks__total">
              <span>
                {t('skills.total')} <Hours minutes={totalMinutes(totals)} />
              </span>
              <span className="sks__total-recent">
                {t('skills.recent', { days: PACE_DAYS })} <Hours minutes={recentTotal} />
              </span>
            </p>

            {!inPast && (
              <DayPickerToggle open={pickerOpen} onToggle={() => setPickerOpen(!pickerOpen)} />
            )}
          </div>

          {(pickerOpen || inPast) && (
            <DayPicker
              value={writeDay}
              // Точка означает «в этот день у навыков что-то есть»: у привязанного
              // это блоки приоритета, у самостоятельного — свои. Спрашиваем ровно
              // то, что экран потом и покажет.
              hasEntries={(day) => skills.skills.some((s) => skillBlocksOn(s, ctx, day) > 0)}
              onChange={setWriteDay}
            />
          )}

          {inPast && (
            <PastDayNotice
              day={writeDay}
              onBack={() => {
                setWriteDay(today);
                setPickerOpen(false);
              }}
            />
          )}
        </div>
      )}

      <div className="app__body">
        {totals.length === 0 ? (
          <SkillsEmpty onAdd={() => setAdding(true)} />
        ) : (
          <>
            <ul className="sks__list">
              {totals.map((item) => (
                <SkillRow
                  key={item.skill.id}
                  total={item}
                  dayBlocks={skillBlocksOn(item.skill, ctx, writeDay)}
                  recentMinutes={recentMinutes.get(item.skill.id) ?? 0}
                  historyDays={historyDays}
                  historyBlocks={historyBlocks.get(item.skill.id) ?? []}
                  blockMinutes={blockMinutes}
                  onAdd={() => addBlock(item.skill.id)}
                  onOpen={() => setOpenId(item.skill.id)}
                />
              ))}
            </ul>
            <p className="sks__hint">{t('skills.hint')}</p>
          </>
        )}

        {/* На пустом экране кнопка своя — она стоит поверх примера, см.
            SkillsEmpty. Вторая такая же под ним была бы дублем. */}
        {totals.length > 0 && (
          <button
            className="btn press"
            type="button"
            disabled={atLimit}
            onClick={() => setAdding(true)}
          >
            {atLimit ? t('skills.limit', { max: MAX_SKILLS }) : t('skills.add')}
          </button>
        )}

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
        day={writeDay}
        dayBlocks={openSkill ? skillBlocksOn(openSkill, ctx, writeDay) : 0}
        recentMinutes={openSkill ? recentMinutes.get(openSkill.id) ?? 0 : 0}
        historyDays={historyDays}
        historyBlocks={openSkill ? historyBlocks.get(openSkill.id) ?? [] : []}
        onAdd={() => openSkill && addBlock(openSkill.id)}
        onRemove={() => openSkill && removeBlock(openSkill.id)}
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
  const picked = allSuggestions().includes(title.trim()) ? title.trim() : '';

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
              <optgroup key={group.titleKey} label={t(group.titleKey)}>
                {group.titles.map((key) => {
                  const name = t(key);
                  return (
                    <option key={key} value={name} disabled={taken.has(name.toLowerCase())}>
                      {name}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path d="M6 10l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </label>
      ) : (
        <input
          className="field"
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

      <button className="btn-accent press" type="submit" disabled={!canSubmit}>
        {t('common.add')}
      </button>
    </form>
  );
}
