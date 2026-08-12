/*
 * Маленький пример приоритетов — то, что стоит в герое вместо приложения на
 * телефоне.
 *
 * Зачем он вообще, если рядом есть настоящее приложение во фрейме: на
 * сенсорном экране вложенная прокручиваемая область забирает жест себе, и
 * страница перестаёт скроллиться пальцем. Встроенное приложение того не стоит.
 * Здесь же нет ни фрейма, ни прокрутки — четыре строки, которые помещаются в
 * один экран и тапаются по-настоящему.
 *
 * Показывает он ровно одно правило, главное в продукте: **полоса меряется
 * относительно лидера, а не суток**. Поэтому лидер всегда во всю ширину, а
 * остальные — в его долях, и при каждом тапе доли пересчитываются у всех сразу.
 * Объяснять это текстом бесполезно, а тремя тапами — понятно.
 *
 * Разметка строк рисуется отсюда, а не лежит в HTML: у каждой строки семь
 * элементов, и четыре копии подряд в index.html читались бы хуже, чем один
 * цикл. Значения при этом объявлены в HTML — правится состав примера там же,
 * где он стоит.
 */

/** Цена клика по умолчанию в приложении. Тот же DEFAULT_BLOCK_MINUTES. */
const BLOCK_MINUTES = 30;

/**
 * Минимальная заливка ненулевой полосы — та же, что в приложении: один блок на
 * фоне лидера иначе выглядит как ноль, и разница между «мало» и «ничего»
 * пропадает.
 */
const MIN_FILL = 4;

const root = document.querySelector('[data-mini]');

if (root) {
  const rows = [...root.querySelectorAll('[data-mini-row]')];
  const sumOut = root.querySelector('[data-mini-sum]');
  const hint = root.querySelector('[data-mini-hint]');
  const reset = root.querySelector('[data-mini-reset]');

  const start = rows.map((row) => Number(row.dataset.blocks) || 0);
  const state = [...start];
  let touched = false;

  /** «30 м», «1 ч», «2,5 ч» — как в приложении. */
  function formatMinutes(total) {
    if (total < 60) return `${total} м`;
    const hours = total / 60;
    return `${(Math.round(hours * 10) / 10).toLocaleString('ru-RU')} ч`;
  }

  function build() {
    for (const [index, row] of rows.entries()) {
      row.innerHTML = '';

      const name = document.createElement('span');
      name.className = 'mini__name';
      name.textContent = row.dataset.title;

      const value = document.createElement('span');
      value.className = 'mini__value';
      value.dataset.role = 'value';

      const track = document.createElement('span');
      track.className = 'mini__track';
      const fill = document.createElement('span');
      fill.className = 'mini__fill';
      fill.dataset.role = 'fill';
      track.append(fill);

      const plus = document.createElement('button');
      plus.className = 'mini__plus press';
      plus.type = 'button';
      plus.setAttribute('aria-label', `Добавить полчаса: ${row.dataset.title}`);
      plus.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M12 5.5v13M5.5 12h13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>' +
        '</svg>';
      plus.addEventListener('click', () => add(index));

      row.append(name, value, track, plus);
    }
  }

  function add(index) {
    state[index] += 1;
    touched = true;
    draw();
  }

  function draw() {
    const total = state.reduce((acc, blocks) => acc + blocks, 0);
    const leader = Math.max(...state);

    for (const [index, row] of rows.entries()) {
      const blocks = state[index];
      const minutes = blocks * BLOCK_MINUTES;

      const share = leader > 0 ? (blocks / leader) * 100 : 0;
      const width = blocks > 0 ? Math.max(MIN_FILL, share) : 0;

      row.querySelector('[data-role="fill"]').style.width = `${width}%`;
      row.querySelector('[data-role="value"]').textContent = blocks > 0 ? formatMinutes(minutes) : '—';
      row.classList.toggle('mini__row--empty', blocks === 0);
    }

    if (sumOut) {
      const best = state.indexOf(leader);
      const percent = total > 0 ? Math.round((leader / total) * 100) : 0;
      sumOut.textContent =
        total > 0
          ? `${formatMinutes(total * BLOCK_MINUTES)} · лидер: ${rows[best].dataset.title}, ${percent}%`
          : 'пока ничего';
    }

    if (reset) reset.hidden = !touched;
    if (hint && touched) hint.textContent = 'Полоса лидера всегда во всю ширину — остальные в его долях';
  }

  reset?.addEventListener('click', () => {
    state.splice(0, state.length, ...start);
    touched = false;
    if (hint) hint.textContent = 'Нажми «+» — это полчаса твоей жизни';
    draw();
  });

  build();
  draw();
}
