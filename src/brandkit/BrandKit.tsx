/*
 * Брендкит: одна страница, на которой видно всю систему стилей приложения.
 *
 * Три правила, на которых он держится:
 *
 *   1. Токены не переписываются, а читаются. Палитра, кегли, отступы и радиусы
 *      разбираются из самого styles/tokens.css (см. readTokens.ts), значения
 *      берутся у живого документа. Списка, который надо не забыть обновить,
 *      здесь нет ни одного.
 *   2. Компоненты не копируются, а рендерятся. Ниже стоят те же <Toggle>,
 *      <Sheet>, <PriorityRow>, что и на экранах. Если тут что-то выглядит не
 *      так, значит оно не так выглядит и в приложении.
 *   3. Чего повторить нельзя — не показывается. Карточки живут разметкой внутри
 *      своих экранов; их копия разошлась бы с оригиналом на первой же правке, и
 *      вместо справочника вышла бы вторая правда. Про такие места брендкит
 *      честно говорит, где они лежат.
 *
 * Текст страницы написан литералами, а не через t(), и это единственное место в
 * приложении, где так можно. Брендкит — поверхность разработчика: он называет
 * классы, токены и hex-коды, а они не переводятся. Заводить под них ключи в
 * i18n значило бы засорить словарь интерфейса тем, что интерфейсом не является.
 */

import { useRef } from 'react';

import { Accent, Colors, Geometry, Glow, Mark, Typography } from './sections/Foundation';
import { Buttons, Fields, Switches } from './sections/Controls';
import { Indicators, Overlays, Rows, States } from './sections/Blocks';
import { A11y, AllTokens, Icons, Motion, Voice } from './sections/Meta';
import { revealInStrip } from '../components/strip';
import { TOKEN_GROUPS, tokenNames } from './readTokens';
import './BrandKit.css';

const NAV = [
  { id: 'mark', title: 'Знак' },
  { id: 'colors', title: 'Палитра' },
  { id: 'accent', title: 'Акцент' },
  { id: 'type', title: 'Шрифт' },
  { id: 'grid', title: 'Сетка' },
  { id: 'glow', title: 'Свечение' },
  { id: 'buttons', title: 'Кнопки' },
  { id: 'fields', title: 'Поля' },
  { id: 'switches', title: 'Управление' },
  { id: 'rows', title: 'Строки' },
  { id: 'indicators', title: 'Индикаторы' },
  { id: 'overlays', title: 'Шторка' },
  { id: 'states', title: 'Состояния' },
  { id: 'motion', title: 'Движение' },
  { id: 'icons', title: 'Значки' },
  { id: 'a11y', title: 'Доступность' },
  { id: 'voice', title: 'Голос' },
  { id: 'all', title: 'Все токены' },
];

const SIZES = tokenNames('--fs-').map((name) => ({ name }));
const WEIGHTS = tokenNames('--fw-').map((name) => ({ name }));

export function BrandKit(): JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null);

  /*
   * Прокрутка живёт внутри .app__body, а не у страницы, поэтому обычная ссылка
   * с якорем сюда не годится: она увела бы за собой весь документ. Считаем
   * смещение сами — от верха контейнера, с запасом под неподвижную полосу.
   */
  const goTo = (id: string): void => {
    const body = bodyRef.current;
    const target = document.getElementById(`bk-${id}`);
    if (!body || !target) return;
    const top = target.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    body.scrollTo({ top: top - 8, behavior: 'smooth' });
  };

  return (
    <>
      <header className="header">
        <h1 className="header__title">Брендкит</h1>
      </header>

      <div className="app__sticky">
        <nav className="bk__nav" aria-label="Разделы брендкита">
          {NAV.map((item) => (
            <button
              key={item.id}
              className="bk__nav-item"
              type="button"
              onClick={(event) => {
                // Разделов восемнадцать, в ряд помещается пять: без этого до
                // последних не добраться нигде, кроме телефона.
                revealInStrip(event.currentTarget);
                goTo(item.id);
              }}
            >
              {item.title}
            </button>
          ))}
        </nav>
      </div>

      <div className="app__body bk" ref={bodyRef}>
        <p className="bk__intro">
          Всё ниже читается из кода, а не описывается словами по памяти: {TOKEN_GROUPS.length} групп
          токенов разобраны из <code className="bk__code">styles/tokens.css</code>, компоненты — те
          же самые, что стоят на экранах. Собирая новый экран, берите отсюда, а не из соседнего
          файла: одинаковым интерфейс делает не вкус, а один и тот же источник.
        </p>

        <Mark />
        <Colors groups={TOKEN_GROUPS} />
        <Accent />
        <Typography sizes={SIZES} weights={WEIGHTS} />
        <Geometry groups={TOKEN_GROUPS} />
        <Glow />
        <Buttons />
        <Fields />
        <Switches />
        <Rows />
        <Indicators />
        <Overlays />
        <States />
        <Motion />
        <Icons />
        <A11y />
        <Voice />
        <AllTokens />
      </div>
    </>
  );
}
