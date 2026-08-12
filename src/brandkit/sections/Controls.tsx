/* Всё, что нажимают: кнопки, поля, переключатели. */

import { useState } from 'react';

import { BatteryIcon } from '../../components/BatteryIcon';
import { BlockTuner } from '../../components/BlockTuner';
import { ColorPicker } from '../../components/ColorPicker';
import { DayPicker } from '../../components/DayPicker';
import { PeriodSwitch } from '../../components/PeriodSwitch';
import { Toggle } from '../../components/Toggle';
import { lastNDays, todayKey } from '../../domain/date';
import { PERIODS, type PeriodId } from '../../domain/periods';
import { batteryTheme, batteryTitle } from '../../domain/palette';
import { BATTERY_LEVELS, type BatteryLevel } from '../../domain/types';
import { Grid, Item, Section } from '../parts';

export function Buttons(): JSX.Element {
  const style = { '--accent': '#22e356' } as React.CSSProperties;

  return (
    <Section
      id="buttons"
      title="Кнопки"
      lead={
        <>
          Три класса на всё приложение, и они лежат в{' '}
          <code className="bk__code">styles/ui.css</code>, а не в стилях какого-нибудь экрана. Это не
          модификаторы одной кнопки: у широкой есть верхний отступ, у главной его нет — она стоит в
          колонке формы, где зазор задаёт родитель.
        </>
      }
    >
      <div className="bk__block" style={style}>
        <h3 className="eyebrow bk__sub">Главное действие</h3>
        <button className="btn-accent press bk__flush" type="button">
          Сохранить
        </button>
        <code className="bk__code">.btn-accent</code>
        <p className="bk__text">
          Единственная сплошная заливка в приложении, и на экране такая кнопка одна. Текст тёмный,
          потому что заливка — неон: белое по неону не читается ни на одном из шестнадцати цветов.
          Но не чистый чёрный, а с двадцатью процентами самого акцента — плоский{' '}
          <code className="bk__code">#000</code> выглядел на светящейся плашке вырезанной дырой.
          Книзу заливка чуть темнеет, сверху её обводит светлая волосяная линия: без них ровный
          прямоугольник неона читался засвеченным местом, а не предметом.
        </p>
        <button className="btn-accent press bk__flush" type="button" disabled>
          Сохранить
        </button>
        <code className="bk__code">.btn-accent:disabled</code>
      </div>

      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Вторичное действие</h3>
        <button className="btn press" type="button">
          Добавить приоритет
        </button>
        <code className="bk__code">.btn</code>
        <button className="btn press" type="button" disabled>
          Добавить приоритет
        </button>
        <code className="bk__code">.btn:disabled</code>
      </div>

      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Опасное действие</h3>
        <button className="btn-danger btn-danger--stack press" type="button">
          <b>Стереть историю</b>
          <small>Приоритеты и навыки останутся, время обнулится</small>
        </button>
        <code className="bk__code">.btn-danger.btn-danger--stack</code>
        <button className="btn-danger press bk__flush" type="button">
          Удалить
        </button>
        <code className="bk__code">.btn-danger</code>
        <p className="bk__text">
          Красным подсвечен только контур. Сплошная заливка на чёрном читается как основное
          действие — а это последнее, что стоит нажимать случайно. Вариант с подписью объясняет себя
          второй строкой: без неё разница между «стереть историю» и «стереть всё» стоила бы
          пользователю данных.
        </p>
      </div>

      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Кнопки-значки</h3>
        <Grid>
          <Item code=".prow__add" note="46×46 · «+ полчаса» в строке приоритета">
            <span style={style}>
              <button className="prow__add press" type="button" aria-label="Добавить блок">
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path d="M12 5.5v13M5.5 12h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          </Item>
          <Item code=".tune__btn" note="62×62 · шаг в шторке">
            <span style={style}>
              <button className="tune__btn press" type="button" aria-label="Больше">
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                  <path d="M12 5.5v13M5.5 12h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          </Item>
          <Item code=".header__btn" note="36×36 · в шапке">
            <button className="header__btn press" type="button" aria-label="Править">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 20h4L19 9l-4-4L4 16z" />
              </svg>
            </button>
          </Item>
          <Item code=".tune__btn:disabled" note="выключено — контур без цвета">
            <span style={style}>
              <button className="tune__btn" type="button" disabled aria-label="Меньше">
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                  <path d="M5.5 12h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          </Item>
        </Grid>
      </div>

      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Нажатие</h3>
        <p className="bk__text">
          Отклик на палец — один класс на всё приложение: <code className="bk__code">.press</code>,{' '}
          <code className="bk__code">scale(0.96)</code> и прозрачность 0.85 за сотую долю секунды.
          Он висит на сорока девяти кнопках в двадцати одном файле. Новая кнопка без него выглядит
          сломанной, даже если работает.
        </p>
        <button className="btn press bk__flush" type="button">
          Нажмите и подержите
        </button>
        <code className="bk__code">.press:active</code>
      </div>
    </Section>
  );
}

export function Fields(): JSX.Element {
  const [text, setText] = useState('Спорт');
  const style = { '--accent': '#35e0ff' } as React.CSSProperties;

  return (
    <Section
      id="fields"
      title="Поля ввода"
      lead={
        <>
          Кегль поля — ровно 16 пикселей и меньше быть не может: на любом меньшем значении iOS
          зумит страницу при фокусе, и человек оказывается в приложении с двойным масштабом без
          способа вернуться.
        </>
      }
    >
      <div className="bk__block" style={style}>
        <input
          className="field"
          value={text}
          maxLength={24}
          autoComplete="off"
          aria-label="Название"
          onChange={(event) => setText(event.target.value)}
        />
        <code className="bk__code">.field</code>
        <input className="field bk__gap" placeholder="Название приоритета" aria-label="Пусто" readOnly />
        <code className="bk__code">.field::placeholder</code>
        <p className="bk__text">
          В фокусе обводка становится акцентной — это единственный признак фокуса в приложении, и
          именно поэтому у поля всегда должен быть выставлен <code className="bk__code">--accent</code>.
        </p>
      </div>

      <div className="bk__block" style={style}>
        <h3 className="eyebrow bk__sub">Нативные поля</h3>
        <Grid>
          <Item code='type="time"' note="время отметки заряда">
            <input type="time" defaultValue="09:30" className="bk__native" aria-label="Время" />
          </Item>
          <Item code='type="date"' note="когда начали заниматься">
            <input type="date" defaultValue="2019-04-01" className="bk__native" aria-label="Дата" />
          </Item>
          <Item code='type="number"' note="часы до приложения">
            <input type="number" defaultValue={120} className="bk__native" aria-label="Часы" />
          </Item>
        </Grid>
        <p className="bk__text">
          Нативные поля перекрашиваются, но не перерисовываются: календарь и часы рисует система, и
          подменять их нечем. Держит их в теме <code className="bk__code">color-scheme: dark</code>{' '}
          в корне.
        </p>
      </div>
    </Section>
  );
}

export function Switches(): JSX.Element {
  const [on, setOn] = useState(true);
  const [period, setPeriod] = useState<PeriodId>('week');
  const [colorId, setColorId] = useState(3);
  const [blocks, setBlocks] = useState(3);
  const [day, setDay] = useState(todayKey());
  const [level, setLevel] = useState<BatteryLevel>(3);

  const marked = new Set(lastNDays(14).filter((_, index) => index % 3 === 0));

  return (
    <Section
      id="switches"
      title="Управление"
      lead="Живые компоненты, а не их копии: всё ниже — те же файлы, что стоят на экранах. Если что-то здесь выглядит не так, значит оно не так выглядит и в приложении."
    >
      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Тумблер</h3>
        <Toggle
          label="Навыки"
          note="Отдельный счёт часов по ремёслам"
          checked={on}
          onChange={setOn}
        />
        <Toggle label="Выключенный" note="Так выглядит недоступный" checked={false} disabled onChange={() => undefined} />
        <code className="bk__code">&lt;Toggle /&gt; · role=&quot;switch&quot;</code>
      </div>

      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Сегменты</h3>
        <PeriodSwitch periods={PERIODS} value={period} onChange={setPeriod} />
        <code className="bk__code">&lt;PeriodSwitch /&gt; · role=&quot;tablist&quot;</code>
        <p className="bk__text">
          Выбранный сегмент отмечен не классом-модификатором, а{' '}
          <code className="bk__code">aria-selected</code>: состояние в разметке и состояние в стилях
          — одно и то же, и разойтись им негде.
        </p>
      </div>

      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Палитра</h3>
        <ColorPicker value={colorId} onChange={setColorId} />
        <code className="bk__code">&lt;ColorPicker /&gt; · aria-pressed</code>
      </div>

      <div className="bk__block" style={{ '--accent': '#a56bff' } as React.CSSProperties}>
        <h3 className="eyebrow bk__sub">Шаг</h3>
        <BlockTuner
          blocks={blocks}
          blockMinutes={30}
          caption="сегодня"
          onAdd={() => setBlocks((value) => value + 1)}
          onRemove={() => setBlocks((value) => Math.max(0, value - 1))}
        />
        <code className="bk__code">&lt;BlockTuner /&gt;</code>
      </div>

      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Дни</h3>
        <DayPicker value={day} hasEntries={(key) => marked.has(key)} onChange={setDay} />
        <code className="bk__code">&lt;DayPicker /&gt; · 14 дней назад</code>
      </div>

      <div className="bk__block">
        <h3 className="eyebrow bk__sub">Уровни заряда</h3>
        <div className="bsheet">
          {BATTERY_LEVELS.map((item) => {
            const theme = batteryTheme(item);
            const active = item === level;
            return (
              <button
                key={item}
                className={active ? 'bsheet__item press bsheet__item--active' : 'bsheet__item press'}
                style={{ '--accent': theme.hex } as React.CSSProperties}
                type="button"
                aria-pressed={active}
                onClick={() => setLevel(item)}
              >
                <BatteryIcon level={item} width={72} dimmed={!active} />
                <span className="bsheet__title">{batteryTitle(item)}</span>
                <span className="bsheet__label">{theme.label}</span>
              </button>
            );
          })}
        </div>
        <code className="bk__code">.bsheet__item</code>
      </div>
    </Section>
  );
}
