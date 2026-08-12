/*
 * Движение на странице. Три вещи, и все три необязательны.
 *
 * Правило, которому здесь всё подчинено: без скрипта страница должна быть
 * полной и правильной. Поэтому появление секций включается отсюда же — класс
 * на <html> ставится первой строкой, до отрисовки. Если скрипт не выполнился
 * (ошибка, старый браузер, отключённый JS), класса нет, и CSS показывает всё
 * сразу вместо того, чтобы навсегда спрятать половину страницы.
 *
 * prefers-reduced-motion гасит всё до единого: CSS-переходы схлопывает медиа-
 * запрос в landing.css, а перебор состояний батареи не запускается вовсе —
 * схлопнутый до нуля бесконечный цикл дал бы не покой, а мельтешение. Ровно
 * та же оговорка сделана в приложении про спиннер (src/styles/global.css).
 */

const still = window.matchMedia('(prefers-reduced-motion: reduce)');

/*
 * Ставим до первой отрисовки: скрипт грузится модулем из <head>, то есть
 * отложенно, но раньше, чем браузер покажет страницу пользователю. Класс
 * включает начальное «спрятано» в CSS — без него ничего не прячется.
 */
if (!still.matches) document.documentElement.classList.add('motion');

/* --- Появление секций при прокрутке ---------------------------------------- */

const targets = document.querySelectorAll('[data-reveal]');

if (targets.length && !still.matches && 'IntersectionObserver' in window) {
  const watcher = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('shown');
        // Один раз: секция, уехавшая вверх, не должна гаснуть за спиной.
        watcher.unobserve(entry.target);
      }
    },
    // Нижние 12% экрана не считаются: блок «появляется» уже войдя в кадр,
    // а не в момент, когда его край только показался из-за края.
    { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
  );

  for (const target of targets) watcher.observe(target);
} else {
  for (const target of targets) target.classList.add('shown');
}

/* --- Неоновое поле за героем ------------------------------------------------ */

/*
 * Решётка и пятно ходят за указателем — но с запаздыванием, а не приклеенно.
 * Приклеенное пятно читается как курсор мыши и раздражает; отстающее выглядит
 * как свет, у которого есть инерция.
 *
 * Без указателя (телефон, планшет) точка идёт по собственной медленной орбите:
 * мёртвый прямоугольник на первом экране хуже, чем движение, которого никто не
 * просил. При prefers-reduced-motion не делается ни того, ни другого.
 */
const field = document.querySelector('[data-field]');

if (field && !still.matches) {
  const hero = field.closest('.hero');
  // Доли, а не проценты: удобнее считать, в CSS уходят процентами.
  let x = 0.72;
  let y = 0.38;
  let toX = x;
  let toY = y;
  let pointer = false;
  let frame = 0;
  let alive = true;

  hero.addEventListener('pointermove', (event) => {
    // Только настоящий указатель: тап пальцем дал бы рывок в точку касания.
    if (event.pointerType !== 'mouse') return;
    const box = hero.getBoundingClientRect();
    toX = (event.clientX - box.left) / box.width;
    toY = (event.clientY - box.top) / box.height;
    pointer = true;
  });

  hero.addEventListener('pointerleave', () => {
    pointer = false;
  });

  const tick = (time) => {
    if (!alive) return;

    if (!pointer) {
      // Орбита с несовпадающими периодами: путь не замыкается и не читается
      // как повтор.
      toX = 0.5 + Math.cos(time / 7200) * 0.3;
      toY = 0.45 + Math.sin(time / 5100) * 0.26;
    }

    // Догоняем цель по одной десятой расстояния за кадр — та самая инерция.
    x += (toX - x) * 0.06;
    y += (toY - y) * 0.06;

    field.style.setProperty('--px', `${(x * 100).toFixed(2)}%`);
    field.style.setProperty('--py', `${(y * 100).toFixed(2)}%`);
    frame = window.requestAnimationFrame(tick);
  };

  frame = window.requestAnimationFrame(tick);

  /*
   * Цикл живёт, только пока герой на экране и вкладка открыта: кадр в секунду,
   * потраченный на невидимое свечение, — это заряд чужого телефона.
   */
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      alive = entry.isIntersecting && !document.hidden;
      window.cancelAnimationFrame(frame);
      if (alive) frame = window.requestAnimationFrame(tick);
    }
  });
  watcher.observe(hero);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    alive = false;
    window.cancelAnimationFrame(frame);
  });
}

/* --- Заполнение полос приоритетов ------------------------------------------ */

const bars = document.querySelector('[data-bars]');

if (bars) {
  const fills = [...bars.querySelectorAll('[data-width]')];
  const fill = () => {
    for (const [index, bar] of fills.entries()) {
      // Лесенкой: полосы наливаются сверху вниз, как в приложении при пересчёте.
      bar.style.transitionDelay = still.matches ? '0s' : `${index * 90}ms`;
      bar.style.width = `${bar.dataset.width}%`;
    }
  };

  if (still.matches || !('IntersectionObserver' in window)) {
    fill();
  } else {
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          fill();
          watcher.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    watcher.observe(bars);
  }
}

/* --- Батарея в финале перебирает состояния --------------------------------- */

/*
 * Те же четыре темы, что в src/domain/palette.ts: цвет, число залитых ячеек и
 * английская подпись. Подписи не переводятся намеренно — в приложении это
 * часть оформления, а не текст интерфейса.
 */
const LEVELS = [
  { shape: '#bat-3', color: 'var(--battery-high)', label: 'HIGH' },
  { shape: '#bat-2', color: 'var(--battery-mid)', label: 'MEDIUM' },
  { shape: '#bat-1', color: 'var(--battery-low)', label: 'LOW' },
  { shape: '#bat-4', color: 'var(--battery-charge)', label: 'CHARGING' },
];

/** Сколько держится один уровень. Меньше двух секунд — уже мельтешение. */
const HOLD_MS = 2600;

const shape = document.querySelector('[data-battery-shape]');
const label = document.querySelector('[data-battery-label]');

if (shape && label && !still.matches && 'IntersectionObserver' in window) {
  const mark = shape.closest('svg');
  const section = mark.closest('.final');
  let step = 0;
  let timer = 0;

  const show = () => {
    step = (step + 1) % LEVELS.length;
    const level = LEVELS[step];
    shape.setAttribute('href', level.shape);
    // Одно свойство на всю секцию: батарея и подпись под ней красятся вместе.
    section.style.setProperty('--accent', level.color);
    label.textContent = level.label;
  };

  /*
   * Крутится только пока батарея на экране. Таймер, работающий в фоне, тратит
   * заряд настоящего телефона — на странице про личный ресурс это было бы
   * особенно неловко.
   */
  const watcher = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        window.clearInterval(timer);
        if (entry.isIntersecting) timer = window.setInterval(show, HOLD_MS);
      }
    },
    { threshold: 0.4 },
  );

  watcher.observe(mark);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) window.clearInterval(timer);
  });
}
