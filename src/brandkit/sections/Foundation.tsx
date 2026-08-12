/* Основа: знак, цвет, акцент, шрифт, сетка, свечение. */

import { useState } from 'react';

import { BatteryCaption, BatteryIcon } from '../../components/BatteryIcon';
import { BATTERY_GEOMETRY } from '../../components/batteryGeometry';
import { NEON_PALETTE, batteryTheme } from '../../domain/palette';
import { BATTERY_LEVELS } from '../../domain/types';
import { ColorCard, Fact, Facts, Grid, Item, Section } from '../parts';
import { computedToken } from '../readTokens';

const G = BATTERY_GEOMETRY;

export function Mark(): JSX.Element {
  return (
    <Section
      id="mark"
      title="Знак"
      lead={
        <>
          Батарейка — единственный знак приложения. Она же иконка на домашнем экране, она же
          картинка ссылки, она же обои. Форма нигде не перерисовывается заново: пропорции лежат в{' '}
          <code className="bk__code">components/batteryGeometry.ts</code> и оттуда попадают и в SVG,
          и в холст обоев, и в генератор иконок.
        </>
      }
    >
      <Grid>
        {BATTERY_LEVELS.map((level) => (
          <Item key={level} code={`<BatteryIcon level={${level}} />`} note={batteryTheme(level).label}>
            <BatteryIcon level={level} width={92} />
          </Item>
        ))}
      </Grid>

      <p className="bk__text">
        Заряд и «всё хорошо» залиты одинаково — три ячейки из трёх. Отличает их только молния, и это
        сделано намеренно: заряжаться значит быть полным, но по другой причине.
      </p>

      <Grid>
        <Item code="width={22}" note="в шапке">
          <BatteryIcon level={3} width={22} />
        </Item>
        <Item code="width={48}" note="в списке отметок">
          <BatteryIcon level={3} width={48} />
        </Item>
        <Item code="dimmed" note="пусто, ещё не отмечено">
          <BatteryIcon level={2} width={48} dimmed />
        </Item>
        <Item code="glow={false}" note="в статистике, чтобы не светить в таблицу">
          <BatteryIcon level={3} width={48} glow={false} />
        </Item>
      </Grid>

      <Item wide code="<BatteryCaption />" note="подпись живёт между двумя линиями, капсом, с трекингом 0.42em">
        <BatteryCaption level={3} />
      </Item>

      <p className="bk__text">
        Охранное поле — четырнадцать процентов ширины со всех сторон: столько отступа берут иконки
        приложения (<code className="bk__code">npm run brand</code>). У маскируемой иконки Android
        поле вдвое больше, двадцать два процента, — её обрезают по кругу.
      </p>

      <Facts>
        <Fact name="viewBox" value={`0 0 ${G.viewWidth} ${G.viewHeight}`} />
        <Fact name="корпус" value={`${G.body.w}×${G.body.h}, радиус ${G.body.rx}`} />
        <Fact name="обводка" value={`${G.stroke}`} note="у пустой ячейки — 75% от неё" />
        <Fact name="ячейка" value={`${G.cell.w} шириной, зазор ${G.cell.gap}`} />
        <Fact name="контакт" value={`${G.nub.w}×${G.nub.h}`} note="рисуется тремя внешними сторонами" />
      </Facts>
    </Section>
  );
}

/** Группы токенов, которые показываются как цвет, а не как число. */
const COLOR_GROUPS = ['Поверхности', 'Текст', 'Уровни батареи', 'Палитра приоритетов'];

export function Colors({ groups }: { groups: { title: string; hint?: string; tokens: { name: string; note?: string }[] }[] }): JSX.Element {
  return (
    <Section
      id="colors"
      title="Палитра"
      lead={
        <>
          Светлой темы нет и не будет: <code className="bk__code">color-scheme: dark</code> прибит в
          корне, а тему Telegram приложение осознанно игнорирует. Неон на светлом фоне не читается
          вовсе — это не недоделка, а решение.
        </>
      }
    >
      {COLOR_GROUPS.map((title) => {
        const group = groups.find((item) => item.title === title);
        if (!group) return null;
        const isSurface = title === 'Поверхности';
        return (
          <div key={title} className="bk__block">
            <h3 className="eyebrow bk__sub">{group.title}</h3>
            {group.hint && <p className="bk__text">{group.hint}</p>}
            {group.tokens.map((token) => (
              <ColorCard
                key={token.name}
                name={token.name}
                {...(token.note ? { note: token.note } : {})}
                showContrast={!isSurface}
              />
            ))}
          </div>
        );
      })}

      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Золото плашки достижения</h3>
        <p className="bk__text">
          Единственный цвет вне палитры. Он объявлен внутри <code className="bk__code">.atoast</code>{' '}
          и нигде больше не доступен — достижение должно отличаться от любого другого сообщения
          раньше, чем прочитан текст. Брать его для чего-то ещё нельзя: как только золото появится
          во втором месте, оно перестанет что-либо значить в первом.
        </p>
        <div className="bk__color">
          <span className="bk__color-chip" style={{ background: '#f0c46a' }} aria-hidden="true" />
          <span className="bk__color-body">
            <code>--gold</code>
            <span className="bk__color-value">#f0c46a</span>
            <small>кромка, подпись, медаль</small>
          </span>
        </div>
        <div className="bk__color">
          <span className="bk__color-chip" style={{ background: '#fff2c4' }} aria-hidden="true" />
          <span className="bk__color-body">
            <code>--gold-light</code>
            <span className="bk__color-value">#fff2c4</span>
          </span>
        </div>
        <div className="bk__color">
          <span className="bk__color-chip" style={{ background: '#6f4c12' }} aria-hidden="true" />
          <span className="bk__color-body">
            <code>--gold-deep</code>
            <span className="bk__color-value">#6f4c12</span>
            <small>тёмный край переливающейся кромки</small>
          </span>
        </div>
      </div>
    </Section>
  );
}

/** Ступени подмеса, которыми набран весь цветной интерфейс. */
const TINTS = [
  { percent: 8, what: 'подложка кнопки-значка' },
  { percent: 9, what: 'жёлоб полосы' },
  { percent: 12, what: 'подложка выбранного' },
  { percent: 26, what: 'обводка жёлоба' },
  { percent: 40, what: 'обводка кнопки' },
  { percent: 55, what: 'обводка выбранного' },
  { percent: 72, what: 'обводка выбранной плитки' },
];

export function Accent(): JSX.Element {
  const [colorId, setColorId] = useState(0);
  const color = NEON_PALETTE[colorId] ?? NEON_PALETTE[0]!;
  const style = { '--accent': color.hex, '--accent-soft': color.soft } as React.CSSProperties;

  return (
    <Section
      id="accent"
      title="Акцент"
      lead={
        <>
          Отдельного класса на каждый цвет в приложении нет. Компонент получает{' '}
          <code className="bk__code">--accent</code> инлайном из JSX, а всё остальное — подложка,
          обводка, свечение — считается из него через <code className="bk__code">color-mix</code>.
          Поэтому шестнадцать цветов не стоят ни одной лишней строки CSS.
        </>
      }
    >
      <div className="picker bk__picker">
        {NEON_PALETTE.map((item, index) => (
          <button
            key={item.hex}
            className={index === colorId ? 'picker__dot picker__dot--on' : 'picker__dot'}
            style={{ '--accent': item.hex } as React.CSSProperties}
            type="button"
            aria-label={item.name}
            aria-pressed={index === colorId}
            onClick={() => setColorId(index)}
          />
        ))}
      </div>

      <div className="bk__tints" style={style}>
        {TINTS.map((tint) => (
          <div key={tint.percent} className="bk__tint">
            <span
              className="bk__tint-chip"
              style={{
                background: `color-mix(in srgb, var(--accent) ${tint.percent}%, transparent)`,
                boxShadow: `inset 0 0 0 1px color-mix(in srgb, var(--accent) ${tint.percent}%, transparent)`,
              }}
              aria-hidden="true"
            />
            <code>{tint.percent}%</code>
            <small>{tint.what}</small>
          </div>
        ))}
      </div>

      <p className="bk__text">
        Запасное значение <code className="bk__code">--accent: var(--text)</code> в токенах
        обязательно. Без него <code className="bk__code">color-mix</code> становится невычислимым, и
        свойство сбрасывается в <code className="bk__code">unset</code> — то есть блок, до которого
        акцент не дошёл, теряет и подложку, и обводку разом.
      </p>

      <Grid>
        <Item code="--accent" note={color.name}>
          <span className="bk__tint-chip" style={{ background: color.hex }} />
        </Item>
        <Item code="--accent-soft" note="светлый край градиента заливки">
          <span className="bk__tint-chip" style={{ background: color.soft }} />
        </Item>
        <Item code=".bar" note="градиент идёт от акцента к его светлому краю">
          <span className="bar" style={style}>
            <span className="bar__fill" style={{ width: '64%' }} />
          </span>
        </Item>
      </Grid>
    </Section>
  );
}

/**
 * Кегли, не попавшие в шкалу. Список ручной — вывести его из кода нельзя, а
 * молчать про него нечестно: пока эти значения живут литералами, шкала неполна.
 */
const TYPE_OUTLIERS = [
  { size: '8.5px', where: 'подписи под столбиками графиков' },
  { size: '9px', where: 'счётчик за сегодня под кнопкой «+»' },
  { size: '9.5px', where: 'подписи вкладок, когда вкладок пять' },
  { size: '11.5px', where: 'вторые строки в строках-переходах и красных кнопках' },
  { size: '12.5px', where: 'разбор дня' },
];

export function Typography({
  sizes,
  weights,
}: {
  sizes: { name: string; note?: string }[];
  weights: { name: string }[];
}): JSX.Element {
  return (
    <Section
      id="type"
      title="Типографика"
      lead={
        <>
          Веб-шрифт не загружается ни здесь, ни на лендинге. В{' '}
          <code className="bk__code">--font</code> объявлен Inter Tight, но качать его никто не
          пытается: снимки экранов и живой фрейм на лендинге обязаны совпадать, а системный шрифт
          есть у всех. Это решение, а не забытая строка.
        </>
      }
    >
      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Шкала</h3>
        {sizes.map((token) => (
          <div key={token.name} className="bk__type-row">
            <span className="bk__type-sample" style={{ fontSize: `var(${token.name})` }}>
              Приоритеты
            </span>
            <code>{token.name}</code>
            <span className="bk__type-size">{computedToken(token.name)}</span>
          </div>
        ))}
      </div>

      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Веса</h3>
        {weights.map((token) => (
          <div key={token.name} className="bk__type-row">
            <span className="bk__type-sample" style={{ fontWeight: `var(${token.name})` }}>
              Приоритеты
            </span>
            <code>{token.name}</code>
            <span className="bk__type-size">{computedToken(token.name)}</span>
          </div>
        ))}
      </div>

      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Готовые рецепты</h3>
        <Item wide code=".eyebrow">
          <span className="eyebrow">Надзаголовок</span>
        </Item>
        <Item wide code=".header__title" note="заголовок экрана: 13px, 600, капс, трекинг 0.42em">
          <span className="header__title">Настройки</span>
        </Item>
        <Item wide code=".divider-label" note="разделитель списка: линия, слово, линия">
          <div className="divider-label bk__flush">
            <span>Данные</span>
          </div>
        </Item>
        <Item wide code=".battery-caption__text" note="подпись обоев, капс с самым большим трекингом">
          <BatteryCaption level={3} />
        </Item>
      </div>

      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Исключения</h3>
        <p className="bk__text">
          Эти размеры в шкалу не попали и живут литералами. Список честнее круглой шкалы, в которую
          их вписали бы задним числом: пока строка здесь, у неё есть шанс однажды исчезнуть.
        </p>
        <Facts>
          {TYPE_OUTLIERS.map((row) => (
            <Fact key={row.size} name={row.size} value={row.where} />
          ))}
        </Facts>
      </div>
    </Section>
  );
}

const GEOMETRY_GROUPS = ['Геометрия', 'Отступы', 'Высоты панелей', 'Слои', 'Безопасные зоны'];

export function Geometry({
  groups,
}: {
  groups: { title: string; hint?: string; tokens: { name: string; note?: string }[] }[];
}): JSX.Element {
  return (
    <Section
      id="grid"
      title="Сетка и геометрия"
      lead="Приложение всегда колонка телефонной ширины — и на телефоне, и на мониторе. Растянутый на весь экран список читать нечем: название стоит у левого края, кнопка «+» у правого, и глаз проходит между ними полметра."
    >
      <Grid>
        <Item code="--r-sm" note="10px · значки, мелкие плитки">
          <span className="bk__box" style={{ borderRadius: 'var(--r-sm)' }} />
        </Item>
        <Item code="--r-md" note="14px · кнопки, поля, карточки">
          <span className="bk__box" style={{ borderRadius: 'var(--r-md)' }} />
        </Item>
        <Item code="--r-lg" note="20px · крупные блоки">
          <span className="bk__box" style={{ borderRadius: 'var(--r-lg)' }} />
        </Item>
        <Item code="--r-xl" note="28px · только верх шторки">
          <span className="bk__box" style={{ borderRadius: 'var(--r-xl)' }} />
        </Item>
      </Grid>

      <Grid>
        <Item code="--hairline" note="обычная граница: 9% белого">
          <span className="bk__box" style={{ boxShadow: 'inset 0 0 0 1px var(--hairline)' }} />
        </Item>
        <Item code="--hairline-strong" note="активная граница: 16% белого">
          <span className="bk__box" style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-strong)' }} />
        </Item>
      </Grid>

      {groups.map((group) =>
        GEOMETRY_GROUPS.includes(group.title) ? (
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
        ) : null,
      )}
    </Section>
  );
}

export function Glow(): JSX.Element {
  const style = { '--accent': '#22e356' } as React.CSSProperties;
  return (
    <Section
      id="glow"
      title="Свечение"
      lead="Три способа светиться, и путать их нельзя: текст светится тенью текста, блок — тенью блока, значок — фильтром по currentColor. Ни один из них не рисует ореол вокруг прозрачных мест."
    >
      <Grid>
        <Item code=".neon-text" note="заголовок, число, подпись">
          <span className="neon-text" style={{ ...style, fontSize: 'var(--fs-lg)', fontWeight: 600 }}>
            5 ч 30 мин
          </span>
        </Item>
        <Item code=".neon-box" note="плитка, кнопка, карточка">
          <span className="neon-box bk__box" style={{ ...style, background: '#22e356' }} />
        </Item>
        <Item code=".battery--glow" note="только знак: три тени по currentColor">
          <BatteryIcon level={3} width={72} />
        </Item>
      </Grid>
      <p className="bk__text">
        Свечение всегда идёт от <code className="bk__code">--accent</code> или{' '}
        <code className="bk__code">currentColor</code> — никогда от захардкоженного цвета. Иначе оно
        перестанет следовать за цветом приоритета, и зелёный ореол однажды окажется вокруг красной
        полосы.
      </p>
    </Section>
  );
}
