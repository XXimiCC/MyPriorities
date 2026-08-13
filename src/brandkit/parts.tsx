/*
 * Мелочи, из которых собран сам брендкит: заголовок раздела, площадка под
 * образец, подпись с именем класса, строка «токен — значение».
 *
 * Ни один из этих классов в приложении не используется и использоваться не
 * должен: это оформление витрины, а не часть системы. Витрина обязана быть
 * скучнее того, что показывает, иначе образец не отличить от рамки вокруг него.
 */

import type { ReactNode } from 'react';

import { computedToken, contrastGrade, contrastOn } from './readTokens';

interface SectionProps {
  id: string;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}

export function Section({ id, title, lead, children }: SectionProps): JSX.Element {
  return (
    <section className="bk__section" id={`bk-${id}`}>
      <div className="divider-label">
        <span>{title}</span>
      </div>
      {lead && <p className="bk__lead">{lead}</p>}
      {children}
    </section>
  );
}

/**
 * Образец с подписью. Подпись — не украшение: без имени класса брендкит
 * показывает, как это выглядит, но не отвечает на вопрос «как это повторить».
 */
export function Item({
  code,
  note,
  wide,
  children,
}: {
  code?: string;
  note?: string;
  wide?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={wide ? 'bk__item bk__item--wide' : 'bk__item'}>
      <div className="bk__stage">{children}</div>
      {code && <code className="bk__code">{code}</code>}
      {note && <small className="bk__note">{note}</small>}
    </div>
  );
}

export function Grid({ children }: { children: ReactNode }): JSX.Element {
  return <div className="bk__grid">{children}</div>;
}

/** Строка справочника: слева имя, справа значение. */
export function Fact({
  name,
  value,
  note,
}: {
  name: string;
  value: string;
  note?: string;
}): JSX.Element {
  return (
    <li className="bk__fact">
      <code>{name}</code>
      <span className="bk__fact-value">{value}</span>
      {note && <small>{note}</small>}
    </li>
  );
}

export function Facts({ children }: { children: ReactNode }): JSX.Element {
  return <ul className="bk__facts">{children}</ul>;
}

/**
 * Плашка цвета. Контраст считается к --bg и подписывается вслух: без этого
 * палитра выглядит как набор красивых кружков, по которому нельзя решить, каким
 * из них можно набрать текст.
 */
export function ColorCard({
  name,
  note,
  showContrast = true,
}: {
  name: string;
  note?: string;
  showContrast?: boolean;
}): JSX.Element {
  const value = computedToken(name);
  const background = computedToken('--bg');
  const ratio = showContrast ? contrastOn(value, background) : undefined;
  const grade = ratio === undefined ? undefined : contrastGrade(ratio);

  return (
    <div className="bk__color">
      <span className="bk__color-chip" style={{ background: value }} aria-hidden="true" />
      <span className="bk__color-body">
        <code>{name}</code>
        <span className="bk__color-value">{value}</span>
        {note && <small>{note}</small>}
      </span>
      {grade && ratio !== undefined && (
        <span className={grade.ok ? 'bk__badge' : 'bk__badge bk__badge--off'}>
          {grade.label} · {ratio.toFixed(1)}
        </span>
      )}
    </div>
  );
}
