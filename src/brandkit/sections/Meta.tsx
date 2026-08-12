/* Правила, а не детали: движение, значки, доступность, тон голоса. */

import { useState } from 'react';

import { GROUP_ICONS, accentOf } from '../../achievements/icons';
import { GROUPS } from '../../achievements/types';
import { DEMO_PROFILES } from '../../demo/profiles';
import { PRESETS } from '../../domain/presets';
import { NEON_PALETTE } from '../../domain/palette';
import { Fact, Facts, Section } from '../parts';
import { TOKEN_GROUPS, computedToken } from '../readTokens';

const MOVES = [
  { token: '--t-press', ease: '--ease-state', what: 'нажатие: .press' },
  { token: '--t-state', ease: '--ease-state', what: 'смена цвета и подложки' },
  { token: '--t-move', ease: '--ease-move', what: 'подъём шторки' },
  { token: '--t-fill', ease: '--ease-move', what: 'заливка полосы' },
];

const KEYFRAMES = [
  { name: 'sheet-fade', where: 'components/Sheet.css', what: 'проявление затемнения, 0.2s' },
  { name: 'sheet-rise', where: 'components/Sheet.css', what: 'подъём панели на 18px, 0.28s' },
  { name: 'wp-spin', where: 'styles/global.css', what: 'единственный спиннер, 0.8s' },
  { name: 'hbat-ask', where: 'styles/global.css', what: 'дыхание капсулы «Заряд?», 2.6s' },
  { name: 'atoast-in', where: 'achievements/AchievementToast.css', what: 'выезд плашки, 0.42s' },
  { name: 'atoast-glow', where: 'achievements/AchievementToast.css', what: 'вспышка под плашкой, 1.1s' },
  { name: 'atoast-rim', where: 'achievements/AchievementToast.css', what: 'переливание кромки, 3.6s' },
  { name: 'atoast-sheen', where: 'achievements/AchievementToast.css', what: 'блик, один раз, 1.4s' },
];

export function Motion(): JSX.Element {
  const [run, setRun] = useState(0);

  return (
    <Section
      id="motion"
      title="Движение"
      lead="Две кривые на всё приложение. ease — для того, что меняет цвет; «пружина» cubic-bezier(0.22, 1, 0.36, 1) — для того, что едет. Третьей кривой быть не должно: как только их станет три, разница между ними перестанет читаться."
    >
      <button className="btn press" type="button" onClick={() => setRun((value) => value + 1)}>
        Проиграть ещё раз
      </button>

      <div className="bk__moves" key={run}>
        {MOVES.map((move) => (
          <div key={move.token} className="bk__move">
            <span className="bk__move-track">
              <span
                className="bk__move-dot"
                style={
                  {
                    '--bk-duration': `var(${move.token})`,
                    '--bk-ease': `var(${move.ease})`,
                  } as React.CSSProperties
                }
              />
            </span>
            <code>{move.token}</code>
            <span className="bk__move-value">{computedToken(move.token)}</span>
            <small>{move.what}</small>
          </div>
        ))}
      </div>

      <Facts>
        {KEYFRAMES.map((frame) => (
          <Fact key={frame.name} name={`@keyframes ${frame.name}`} value={frame.what} note={frame.where} />
        ))}
      </Facts>

      <p className="bk__text">
        <code className="bk__code">prefers-reduced-motion</code> глушит всё до 0.01 мс — с тремя
        названными исключениями. Спиннер не останавливается, а замедляется: он единственный признак
        того, что приложение живо, и схлопнутый до нуля он давал бы дрожащее кольцо. Дыхание капсулы
        «Заряд?» выключается совсем и заменяется постоянной обводкой — пульсация на такой скорости
        превращается в стробоскоп в шапке. Кромка и блик плашки достижения тоже гасятся полностью.
      </p>
    </Section>
  );
}

export function Icons(): JSX.Element {
  return (
    <Section
      id="icons"
      title="Значки"
      lead={
        <>
          Библиотеки значков нет, эмодзи нет ни одного. Каждый значок — руками написанные пути в
          сетке 24×24: <code className="bk__code">fill=&quot;none&quot;</code>,{' '}
          <code className="bk__code">stroke=&quot;currentColor&quot;</code>, толщина 1.6,
          скруглённые концы. Свечение всегда добавляется снаружи, через CSS-фильтр по currentColor,
          а не SVG-фильтром внутри — иначе оно перестало бы следовать за цветом.
        </>
      }
    >
      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Группы достижений</h3>
        <div className="bk__icons">
          {GROUPS.map((group) => (
            <span
              key={group}
              className="bk__icon"
              style={{ color: accentOf(group).hex }}
              title={group}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {GROUP_ICONS[group].map((d) => (
                  <path key={d} d={d} />
                ))}
              </svg>
            </span>
          ))}
        </div>
        <code className="bk__code">achievements/icons.ts</code>
      </div>

      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Наборы</h3>
        <div className="bk__icons">
          {PRESETS.map((preset) => (
            <span
              key={preset.id}
              className="bk__icon"
              style={{ color: NEON_PALETTE[preset.accentId]?.hex ?? '#f4f4f5' }}
              title={preset.name}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {preset.icon.map((d) => (
                  <path key={d} d={d} />
                ))}
              </svg>
            </span>
          ))}
        </div>
        <code className="bk__code">domain/presets.ts · толщина 1.5</code>
      </div>

      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Демо-профили</h3>
        <div className="bk__icons">
          {DEMO_PROFILES.map((profile) => (
            <span
              key={profile.id}
              className="bk__icon"
              style={{ color: NEON_PALETTE[profile.accentId]?.hex ?? '#f4f4f5' }}
              title={profile.name}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {profile.icon.map((d) => (
                  <path key={d} d={d} />
                ))}
              </svg>
            </span>
          ))}
        </div>
        <code className="bk__code">demo/profiles.ts</code>
      </div>

      <p className="bk__text">
        Значки вкладок и шестерёнка настроек лежат прямо в <code className="bk__code">App.tsx</code>{' '}
        — там же, где список вкладок. Шестерёнка посчитана по окружности, а не нарисована на глаз:
        прежний контур набирался относительными сдвигами, зубцы выходили разной длины, и на
        двадцати пикселях значок читался как кривая звезда. Шесть зубцов, а не восемь: восемь на
        размере вкладки сливаются в рябь.
      </p>
    </Section>
  );
}

export function A11y(): JSX.Element {
  return (
    <Section
      id="a11y"
      title="Доступность"
      lead="Состояние всегда живёт в разметке, а не только в классе: так стилю и скринридеру неоткуда разойтись. Выбранная вкладка — это aria-selected, а не «--on»."
    >
      <Facts>
        <Fact name="role=&quot;dialog&quot;" value="+ aria-modal у шторки" note="+ aria-label из заголовка" />
        <Fact name="role=&quot;tablist&quot;" value="сегменты и таб-бар" note="выбор через aria-selected" />
        <Fact name="role=&quot;switch&quot;" value="тумблер" note="состояние в aria-checked" />
        <Fact name="aria-pressed" value="палитра, уровни заряда" note="кнопка-переключатель, не вкладка" />
        <Fact name="role=&quot;status&quot;" value="плашка достижения" note="читается, не перебивая" />
        <Fact name="aria-hidden" value="все декоративные SVG" note="значок без подписи — шум" />
        <Fact name="aria-label" value="кнопки без текста" note="«+», закрыть, шаг" />
      </Facts>

      <p className="bk__text">
        Скрытая подпись делается через <code className="bk__code">clip-path: inset(50%)</code> в один
        пиксель, а не через <code className="bk__code">display: none</code>: спрятанный так текст
        читается вслух, но не занимает места. Приём в приложении один и живёт в{' '}
        <code className="bk__code">.dpick__full</code> — полная дата у ячейки дня, где глазами видно
        только число.
      </p>

      <p className="bk__text">
        Минимальная цель — 34 пикселя, обычная — 46. Всё, что меньше 34, обязано стоять внутри
        большей нажимаемой области: стрелки в списке правки 26×22 сидят в строке высотой 54.
      </p>
    </Section>
  );
}

const VOICE = [
  {
    rule: 'Приложение говорит с человеком, а не о себе',
    good: 'Пока ничего не отмечено',
    bad: 'Список приоритетов пуст',
  },
  {
    rule: 'Кнопка называет действие, а не соглашается',
    good: 'Стереть историю',
    bad: 'ОК',
  },
  {
    rule: 'Восклицательных знаков нет вовсе',
    good: 'Готово. Двенадцать часов на месте',
    bad: 'Отлично! Всё получилось!',
  },
  {
    rule: 'Число всегда с единицей, а единица склоняется',
    good: '1 блок · 2 блока · 5 блоков',
    bad: '5 блок(ов)',
  },
  {
    rule: 'Про потерю данных говорят прямо',
    good: 'Приоритеты и навыки останутся, время обнулится',
    bad: 'Это действие необратимо',
  },
  {
    rule: 'Подпись объясняет причину, а не повторяет заголовок',
    good: 'Отдельный счёт часов по ремёслам',
    bad: 'Включить навыки',
  },
];

export function Voice(): JSX.Element {
  return (
    <Section
      id="voice"
      title="Тон голоса"
      lead={
        <>
          Весь текст интерфейса лежит в <code className="bk__code">src/i18n</code> и подставляется
          через <code className="bk__code">t()</code> — литералов в разметке нет. Склонения — через{' '}
          <code className="bk__code">plural()</code>: «5 блок(ов)» в приложении не встречается ни
          разу, и это стоит отдельной функции.
        </>
      }
    >
      {VOICE.map((row) => (
        <div key={row.rule} className="bk__voice">
          <b>{row.rule}</b>
          <span className="bk__voice-good">{row.good}</span>
          <span className="bk__voice-bad">{row.bad}</span>
        </div>
      ))}

      <p className="bk__text">
        Английские подписи <code className="bk__code">HIGH / MEDIUM / LOW / CHARGING</code> —
        единственное исключение, и оно не переводится намеренно: это оформление, снятое с
        референсов, а не текст интерфейса. Русское «ВЫСОКИЙ» на обоях выглядело бы подписью к
        картинке, а не частью картинки.
      </p>
    </Section>
  );
}

export function AllTokens(): JSX.Element {
  return (
    <Section
      id="all"
      title="Все токены"
      lead={
        <>
          Полная выгрузка <code className="bk__code">styles/tokens.css</code> — разбирается сам файл,
          а не список, который надо не забыть обновить. Если токена здесь нет, его нет и в
          приложении.
        </>
      }
    >
      {TOKEN_GROUPS.map((group) => (
        <div key={group.title} className="bk__block">
          <h3 className="eyebrow bk__sub">{group.title}</h3>
          {group.hint && <p className="bk__text">{group.hint}</p>}
          <Facts>
            {group.tokens.map((token) => (
              <Fact
                key={token.name}
                name={token.name}
                value={computedToken(token.name)}
                {...(token.note ? { note: token.note } : {})}
              />
            ))}
          </Facts>
        </div>
      ))}
    </Section>
  );
}
