/* Блоки: строки, карточки, индикаторы, шторка, плашка, состояния. */

import { useState } from 'react';

import { BatteryIcon } from '../../components/BatteryIcon';
import { PastDayNotice } from '../../components/DayPicker';
import { PriorityRow } from '../../components/PriorityRow';
import { Sheet } from '../../components/Sheet';
import { lastNDays, todayKey } from '../../domain/date';
import { NEON_PALETTE } from '../../domain/palette';
import type { PriorityStat } from '../../domain/stats';
import { SkillHistory } from '../../skills/SkillHistory';
import { SkillRow } from '../../skills/SkillRow';
import { progressOf } from '../../skills/levels';
import type { SkillTotal } from '../../skills/total';
import { Fact, Facts, Grid, Item, Section } from '../parts';

const DEMO_STAT: PriorityStat = {
  priority: { id: 'bk1', title: 'Работа', colorId: 1 },
  blocks: 14,
  minutes: 420,
  share: 0.42,
  fill: 1,
  archived: false,
};

const DEMO_STAT_2: PriorityStat = {
  priority: { id: 'bk2', title: 'Спорт', colorId: 0 },
  blocks: 5,
  minutes: 150,
  share: 0.15,
  fill: 0.36,
  archived: false,
};

const DEMO_SKILL: SkillTotal = {
  skill: { id: 'gt', title: 'Гитара', colorId: 3, baseMinutes: 60_000, carryBlocks: 0 },
  blocks: 40,
  minutes: 61_200,
  progress: progressOf(61_200),
};

const HISTORY_DAYS = lastNDays(14);
const HISTORY_BLOCKS = [0, 2, 1, 0, 0, 3, 4, 1, 0, 2, 2, 0, 5, 3];

export function Rows(): JSX.Element {
  return (
    <Section
      id="rows"
      title="Строки и карточки"
      lead={
        <>
          Ниже — настоящие компоненты с придуманными данными. Карточки экранов
          (<code className="bk__code">.pcard</code> у наборов, <code className="bk__code">.ach__card</code>{' '}
          у достижений, <code className="bk__code">.dcard</code> у демо) здесь не показаны намеренно:
          они живут разметкой внутри своих экранов, и копия в брендките разошлась бы с оригиналом
          при первой же правке. Общее у них одно и оно ниже — подложка{' '}
          <code className="bk__code">--surface-2</code> с волосяной обводкой и радиусом{' '}
          <code className="bk__code">--r-md</code>.
        </>
      }
    >
      <ul className="bk__list">
        <PriorityRow
          stat={DEMO_STAT}
          todayBlocks={2}
          blockMinutes={30}
          onAdd={() => undefined}
          onOpen={() => undefined}
          onHold={() => undefined}
        />
        <PriorityRow
          stat={DEMO_STAT_2}
          todayBlocks={0}
          blockMinutes={30}
          onAdd={() => undefined}
          onOpen={() => undefined}
          onHold={() => undefined}
        />
      </ul>
      <code className="bk__code">&lt;PriorityRow /&gt;</code>

      <ul className="bk__list bk__gap">
        <SkillRow
          total={DEMO_SKILL}
          dayBlocks={1}
          recentMinutes={240}
          historyDays={HISTORY_DAYS}
          historyBlocks={HISTORY_BLOCKS}
          blockMinutes={30}
          onAdd={() => undefined}
          onOpen={() => undefined}
        />
      </ul>
      <code className="bk__code">&lt;SkillRow /&gt;</code>

      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Строка-переход</h3>
        <button className="navrow press" type="button">
          <span className="navrow__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 4h8v5a4 4 0 01-8 0z" />
              <path d="M8 5H5v2a3 3 0 003 3M16 5h3v2a3 3 0 01-3 3" />
              <path d="M12 13v4M9 20h6M10 17h4l1 3H9z" />
            </svg>
          </span>
          <span className="navrow__text">
            <b>Достижения</b>
            <small>Получено 12 из 75</small>
          </span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <code className="bk__code">.navrow · .navrow__icon · .navrow__text</code>
        <p className="bk__text">
          Значок слева подсвечен жёлтым не ради красоты: строка перехода стоит среди тумблеров, а
          они той же формы и той же подложки. Без пятна цвета переход в списке переключателей никто
          не замечает.
        </p>
      </div>
    </Section>
  );
}

export function Indicators(): JSX.Element {
  const style = { '--accent': '#00f0b5', '--accent-soft': '#6bffd9' } as React.CSSProperties;

  return (
    <Section
      id="indicators"
      title="Индикаторы"
      lead="Всё, что показывает величину, а не принимает нажатие. Общее правило одно: заливка идёт градиентом от акцента к его светлому краю и светится наружу — так полоса читается как источник света, а не как закрашенный прямоугольник."
    >
      <div className="bk__block" style={style}>
        <h3 className="eyebrow bk__sub">Полоса</h3>
        <span className="bar">
          <span className="bar__fill" style={{ width: '100%' }} />
        </span>
        <span className="bar bk__gap">
          <span className="bar__fill" style={{ width: '38%' }} />
        </span>
        <code className="bk__code">.bar · .bar__fill</code>
        <span className="bar bar--thin bk__gap">
          <span className="bar__fill" style={{ width: '62%' }} />
        </span>
        <code className="bk__code">.bar.bar--thin</code>
        <p className="bk__text">
          Тонкий вариант — у навыка. Дальнее свечение с него снято: строки навыков стоят плотнее, и
          ореол в восемнадцать пикселей заливал бы соседей.
        </p>
      </div>

      <div className="bk__block" style={style}>
        <h3 className="eyebrow bk__sub">Полоса дней</h3>
        <SkillHistory days={HISTORY_DAYS} blocks={HISTORY_BLOCKS} blockMinutes={30} />
        <code className="bk__code">&lt;SkillHistory /&gt;</code>
        <p className="bk__text">
          Сегодняшняя ячейка всегда в кольце, даже пустая: полоса отвечает на вопрос «занимался ли
          я сегодня», и пустое место должно быть видно так же ясно, как заполненное.
        </p>
      </div>

      <Grid>
        <Item code=".wp__spinner" note="единственный индикатор загрузки">
          <span className="wp__spinner" />
        </Item>
        <Item code="<BatteryIcon />" note="уровень заряда как индикатор">
          <BatteryIcon level={2} width={64} />
        </Item>
        <Item code=".swatch" note="точка цвета там, где полосы нет">
          <span className="bk__swatch-row">
            {NEON_PALETTE.slice(0, 5).map((color) => (
              <span
                key={color.hex}
                className="swatch"
                style={{ '--accent': color.hex } as React.CSSProperties}
              />
            ))}
          </span>
        </Item>
      </Grid>
    </Section>
  );
}

export function Overlays(): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <Section
      id="overlays"
      title="Шторка и плашка"
      lead="Своего диалога подтверждения в приложении нет: спрашивает всегда системный диалог Telegram. Шторка — для выбора и правки, а не для вопросов «вы уверены».">
      <button className="btn press" type="button" onClick={() => setOpen(true)}>
        Открыть настоящую шторку
      </button>
      <code className="bk__code">&lt;Sheet open title onClose /&gt;</code>

      <Sheet open={open} title="Заголовок шторки" onClose={() => setOpen(false)}>
        <div style={{ '--accent': '#22e356' } as React.CSSProperties}>
        <p className="bk__text bk__flush">
          Панель поднимается снизу за 0.28 секунды по «пружине», затемнение проявляется за 0.2. Всё
          внутри — обычная разметка: у <code className="bk__code">.sheet__content</code> нет
          собственных стилей, и это намеренно.
        </p>
        <button className="btn-accent press bk__gap" type="button" onClick={() => setOpen(false)}>
          Понятно
        </button>
        </div>
      </Sheet>

      <Facts>
        <Fact name=".sheet" value="каркас на всю высоту, z-index 60" />
        <Fact name=".sheet__scrim" value="затемнение 68% + размытие 6px" note="кнопка, а не div: закрывает по нажатию" />
        <Fact name=".sheet__panel" value="--surface, радиус --r-xl сверху, не выше 88%" />
        <Fact name=".sheet__grip" value="38×4, --hairline-strong" />
        <Fact name=".sheet__title" value="12px, 600, капс, трекинг --tracking-wide" />
      </Facts>

      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Плашка достижения</h3>
        <div className="bk__toast">
          <div className="atoast__card" role="status">
            <span className="atoast__medal" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" />
              </svg>
            </span>
            <span className="atoast__text">
              <b>Достижение</b>
              <small>Первая сотня часов</small>
            </span>
            <span className="atoast__open">Открыть</span>
          </div>
        </div>
        <code className="bk__code">.atoast__card</code>
        <p className="bk__text">
          Три слоя: свечение под табличкой, сама табличка и переливающаяся кромка в один пиксель.
          Кромка нарисована градиентом с вырезанной серединой — обычная обводка золотом на чёрном
          выглядит просто жёлтой линией, переливается именно движение градиента.
        </p>
      </div>
    </Section>
  );
}

export function States(): JSX.Element {
  return (
    <Section
      id="states"
      title="Состояния"
      lead="Пусто, идёт загрузка, что-то пошло не так. Скелетонов в приложении нет: данные лежат на устройстве и появляются мгновенно, а мигающие прямоугольники изображали бы работу, которой не было."
    >
      <Item wide code=".empty" note="пустой список">
        <p className="empty">Пока ничего не отмечено</p>
      </Item>

      <Item wide code=".wp__spinner" note="загрузка приложения">
        <span className="wp__spinner" />
      </Item>

      <div className="bk__block">
        <p className="note bk__flush">Обычное пояснение под блоком.</p>
        <code className="bk__code">.note</code>
        <p className="note warn">Предупреждение: что-то работает не так, как ожидалось.</p>
        <code className="bk__code">.note.warn</code>
        <p className="bk__text">
          Жёлтый значит «обратите внимание», а не «ошибка». Красный в приложении занят низким
          зарядом и опасными кнопками, и третьего значения у него быть не может.
        </p>
      </div>

      <div className="bk__block">
        <PastDayNotice day={lastNDays(3)[0] ?? todayKey()} onBack={() => undefined} />
        <code className="bk__code">&lt;PastDayNotice /&gt;</code>
        <p className="bk__text">
          Отдельная полоса, а не подпись: запись задним числом — самая дорогая ошибка в приложении,
          и она обязана быть видна, пока длится.
        </p>
      </div>
    </Section>
  );
}
