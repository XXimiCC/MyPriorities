import { BACK_DAYS } from '../components/DayPicker';
import { lastNDays, parseDayKey, todayKey } from '../domain/date';
import { t } from '../i18n';
import { SkillRow } from './SkillRow';
import { progressOf } from './levels';
import type { Skill, SkillTotal } from './types';
import './SkillsEmpty.css';

interface Props {
  onAdd(): void;
}

/**
 * Пустой экран навыков: размытый пример вместо объяснения словами.
 *
 * Абзац про «навык — это то, во что вкладывают часы годами» объяснял то, что
 * проще показать. Здесь показано: три настоящие строки навыка с лестницей,
 * часами и полосой дней, размытые до состояния «понятно, что будет», и кнопка
 * поверх них.
 *
 * Пример собирается настоящим компонентом `SkillRow`, а не картинкой в
 * `public/`. Картинка весила бы сотню килобайт в бандле у всех и протухала бы
 * при первой же правке строки навыка — а расхождение с настоящим экраном на
 * витрине «как это выглядит» хуже, чем отсутствие витрины.
 */

/** Три жизни, в которые уже вложено. Часы правдоподобные: лестница на них не пустая. */
const SAMPLE: Array<{ skill: Skill; recentMinutes: number; history: number[] }> = [
  {
    skill: { id: 'q1', title: 'Английский', colorId: 1, baseMinutes: 74_000, carryBlocks: 0 },
    recentMinutes: 1290,
    history: [2, 1, 0, 2, 3, 1, 0, 1, 2, 2, 0, 1, 3, 2],
  },
  {
    skill: { id: 'q2', title: 'Гитара', colorId: 5, baseMinutes: 19_500, carryBlocks: 0 },
    recentMinutes: 620,
    history: [1, 0, 0, 1, 1, 0, 2, 0, 1, 0, 0, 1, 1, 0],
  },
  {
    skill: { id: 'q3', title: 'Код', colorId: 0, baseMinutes: 210_000, carryBlocks: 0 },
    recentMinutes: 2400,
    history: [3, 2, 4, 2, 0, 1, 3, 4, 2, 3, 1, 2, 4, 3],
  },
];

const BLOCK_MINUTES = 30;

export function SkillsEmpty({ onAdd }: Props): JSX.Element {
  const days = lastNDays(BACK_DAYS, parseDayKey(todayKey())).slice(-BACK_DAYS);

  return (
    <div className="sksx">
      {/* Пример не кликается и не читается вслух: это фон, а не интерфейс. */}
      <div className="sksx__preview" aria-hidden="true">
        <ul className="sks__list">
          {SAMPLE.map(({ skill, recentMinutes, history }) => {
            const total: SkillTotal = {
              skill,
              blocks: 0,
              minutes: skill.baseMinutes,
              progress: progressOf(skill.baseMinutes),
            };
            return (
              <SkillRow
                key={skill.id}
                total={total}
                dayBlocks={0}
                recentMinutes={recentMinutes}
                historyDays={days}
                historyBlocks={history.slice(-days.length)}
                blockMinutes={BLOCK_MINUTES}
                onAdd={() => undefined}
                onOpen={() => undefined}
              />
            );
          })}
        </ul>
      </div>

      <button className="btn press sksx__add" type="button" onClick={onAdd}>
        {t('skills.add')}
      </button>
    </div>
  );
}
