import { formatHoursParts } from '../domain/date';
import { formats } from '../i18n';
import './Hours.css';

interface Props {
  minutes: number;
  /** Со знаком «плюс» впереди: так показывают прибавку за окно темпа. */
  gain?: boolean;
}

/**
 * Часы, которые не двигают соседей.
 *
 * Разница между «23,5 ч» и «24 ч» — два знака, и при каждом «+» всё, что стояло
 * правее, прыгало влево. Здесь под дробный хвост держится место, даже когда
 * хвоста нет: пустой слот той же ширины.
 *
 * Ширина в ch, а не в пикселях: цифры в шрифте приложения моноширинные
 * (`font-variant-numeric: tabular-nums` в родителе), и «,5» занимает ровно два
 * знакоместа при любом размере текста.
 */
export function Hours({ minutes, gain }: Props): JSX.Element {
  const { head, fraction, unit } = formatHoursParts(minutes);
  return (
    <span className="hours">
      {gain ? '+' : ''}
      {head}
      {fraction}
      {formats().gap}
      {unit}
      {/* Место под «,5» держится ПОСЛЕ единицы, а не между числом и ней:
          внутри строки пустой слот читался бы дырой («26932   ч»), а с краю
          он невидим и делает ровно то, ради чего нужен. */}
      {fraction ? null : (
        <span className="hours__pad" aria-hidden="true">
          {/* Разделитель берётся из локали: запятая и точка разной ширины, и
              распорка не той шириной — тот же прыжок, ради которого она есть. */}
          {formats().decimal}0
        </span>
      )}
    </span>
  );
}
