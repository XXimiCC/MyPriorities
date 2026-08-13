/**
 * Постановка панели: свой корень React рядом с приложением, а не внутри него.
 *
 * Почему отдельный корень, а не компонент в дереве приложения:
 *
 *   переживает падение — непойманное исключение размонтирует весь корень, в
 *     котором оно случилось. Белый экран — самый ценный тикет на свете, и
 *     панель внутри того же дерева гарантировала бы, что завести его нельзя.
 *   не может дотянуться до стора — над ней нет ни одного провайдера, поэтому
 *     шов (host.ts) нельзя обойти, даже если очень захочется.
 *   чистый #root для съёмки — интерфейс панели структурно вне снимаемого
 *     поддерева, и его не приходится вырезать из кадра.
 *   вне StrictMode — эффекты выполняются один раз, а не дважды.
 *
 * Из основного бандла сюда попадает только это: пусковая кнопка нарисована
 * голым DOM, а весь React-слой приезжает динамическим импортом в тот момент,
 * когда его впервые открыли. Посетитель, никогда не делавший жест, платит за
 * панель около двух килобайт.
 *
 * React отсюда не импортируется вовсе — ни статически, ни в типах. Это и
 * позволяет ставить панель на сайты, которые про React не слышали:
 * документацию на Vue и лендинг без фреймворка вообще. См. render.tsx.
 */

import { availability } from './access';
import { installBreadcrumbs } from './breadcrumbs';
import { watchGesture } from './gesture';
import { ask, registerDevkitHost } from './host';
import { resolveInvite } from './invite';
import { watchPending } from './pending';
import { watchTaps } from './selector';
import type { DevkitHost } from './types';

/** По этой отметке съёмка кадра узнаёт и выбрасывает интерфейс самой панели. */
export const MARK = 'data-devkit';

/* Подпись пусковой кнопки написана здесь, а не взята из strings.ts: словарь
   панели целиком уехал бы в основной бандл ради одного слова. */
const LAUNCHER = 'Отладка';

let revealNow: (() => void) | undefined;

/**
 * Показать значок из приложения.
 *
 * Нужно там, где у панели нет своего способа: приложению виднее, какое
 * движение в нём свободно. В «Моих Приоритетах» это долгое — пять секунд —
 * нажатие на строку достижений; случайно столько не держат, а объяснить
 * человеку одним предложением можно.
 *
 * Панель не поставлена или её здесь нет вовсе — вызов ничего не делает и не
 * падает: приложение не обязано знать, собрана ли она в этой сборке.
 */
export function revealDevkit(): void {
  revealNow?.();
}

/** Общий неоновый цвет панели. Значение, а не токен: чужой проект про наши токены не знает. */
const NEON = '53,224,255';

/**
 * Жучок, нарисованный по сетке 24×24 в манере значков приложения.
 *
 * Голова — дуга сверху, панцирь — капсула с закруглениями радиуса 4, спинка
 * делит его пополам, по три ножки на сторону и два усика. Обводка 1.6 с
 * круглыми концами: на сорока четырёх пикселях кружка тонкие линии сливаются,
 * а более толстые превращают жучка в кляксу.
 */
const BUG = [
  'M10 9a2 2 0 0 1 4 0', // голова
  'M10.4 7.4 9 5.8', // усик левый
  'M13.6 7.4 15 5.8', // усик правый
  'M8 13a4 4 0 0 1 8 0v2a4 4 0 0 1-8 0z', // панцирь
  'M12 9.4v9.2', // спинка
  'M8.1 12H5.4',
  'M8 15H5',
  'M8.9 17.6 6.6 19.2', // ножки слева
  'M15.9 12h2.7',
  'M16 15h3',
  'M15.1 17.6 17.4 19.2', // ножки справа
]
  .map((d) => `<path d="${d}"/>`)
  .join('');

const LAUNCHER_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
  `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${BUG}</svg>`;

/*
 * Кнопка садится НАД нижней панелью приложения, а не поверх неё: в углу экрана
 * у приложения обычно живёт что-то нажимаемое, и инструмент отладки не имеет
 * права закрыть собой рабочую кнопку.
 *
 * Высота панели читается из переменной приложения, если она есть, и падает в
 * ноль, если её нет: в чужом проекте про --tabbar-h никто не слышал, и там
 * кнопка просто встанет в самый низ.
 */
const LAUNCHER_STYLE = [
  'position:fixed',
  'left:12px',
  'bottom:calc(12px + var(--tabbar-h, 0px) + var(--safe-bottom, env(safe-area-inset-bottom, 0px)))',
  // Сорок четыре — минимальный размер, в который палец попадает не глядя.
  'width:44px',
  'height:44px',
  'display:grid',
  'place-items:center',
  'padding:0',
  'border-radius:999px',
  `border:1px solid rgba(${NEON},.45)`,
  'background:rgba(4,10,14,.72)',
  'backdrop-filter:blur(10px)',
  '-webkit-backdrop-filter:blur(10px)',
  `color:rgb(${NEON})`,
  /* Свечение снаружи и подсветка изнутри — тот же приём, что у неоновых
     элементов приложения: цвет не заливает форму, а обводит её. */
  `box-shadow:0 0 14px rgba(${NEON},.35),inset 0 0 12px rgba(${NEON},.14)`,
  `filter:drop-shadow(0 0 3px rgba(${NEON},.5))`,
  'pointer-events:auto',
  'cursor:pointer',
  '-webkit-tap-highlight-color:transparent',
].join(';');

export function mountDevkit(host: DevkitHost): () => void {
  registerDevkitHost(host);
  if (typeof document === 'undefined') return () => undefined;

  /* Ключ тестировщика: из адреса, от приложения (в мини-аппе он приезжает не
     адресной строкой) либо запомненный на предыдущей странице. */
  const invite = resolveInvite(window.location.search, ask('invite', (h) => h.invite?.()));

  const mode = availability({
    endpoint: host.endpoint,
    hostname: window.location.hostname,
    search: window.location.search,
    demo: ask('flags', (h) => h.flags?.().demo) ?? false,
    invite,
    asked: ask('visible', (h) => h.visible?.()) ?? false,
  });
  if (mode === 'off') return () => undefined;

  // Перезагрузка модуля в разработке не должна оставлять второй контейнер.
  document.querySelectorAll(`[${MARK}]`).forEach((old) => old.remove());

  const container = document.createElement('div');
  container.setAttribute(MARK, '');
  /* Слой выше всего в приложении (.tabbar живёт на z-index: 20), но сам по себе
     прозрачен для касаний: пустой контейнер не имеет права перехватывать тапы. */
  container.style.cssText =
    'position:fixed;inset:0;z-index:2147483000;pointer-events:none;overscroll-behavior:contain';
  document.body.appendChild(container);

  /*
   * Слой живёт в своём узле, а не прямо в контейнере.
   *
   * Это не аккуратность, а необходимость: createRoot().render() очищает
   * элемент, в который рисует, — и пусковая кнопка, лежи она там же, исчезала
   * бы навсегда при первом же открытии панели. Ровно это и происходило.
   */
  const shell = document.createElement('div');
  container.appendChild(shell);

  let unrender: (() => void) | undefined;
  let opening = false;

  const close = (): void => {
    unrender?.();
    unrender = undefined;
    launcher.style.setProperty('display', '');
  };

  const open = (): void => {
    if (unrender || opening) return;
    opening = true;
    // Кнопка не должна попасть в собственный кадр — он снимается сразу после открытия.
    launcher.style.setProperty('display', 'none');
    void import('./render')
      .then(({ renderDevkit }) => {
        unrender = renderDevkit(shell, close);
      })
      .catch((error: unknown) => {
        // Слой не догрузился — обычно это офлайн. Приложение не должно об этом узнать.
        console.warn('[devkit] слой не загрузился', error);
        launcher.style.setProperty('display', '');
      })
      .finally(() => {
        opening = false;
      });
  };

  const launcher = document.createElement('button');
  launcher.type = 'button';
  // Значок вместо слова: подпись капсом в углу читается как часть приложения,
  // а жучок — как то, чем он и является.
  launcher.setAttribute('aria-label', LAUNCHER);
  launcher.title = LAUNCHER;
  launcher.innerHTML = LAUNCHER_ICON;
  launcher.style.cssText = LAUNCHER_STYLE;
  launcher.addEventListener('click', open);
  // Перед слоем в порядке документа: панель, открывшись, обязана лечь сверху.
  container.insertBefore(launcher, shell);

  /*
   * Жест и сочетание клавиш показывают значок, а не открывают панель.
   *
   * Так одно правило работает везде: «значок открывает панель», а жест лишь
   * решает, есть ли значок. Показанный однажды, он остаётся до конца страницы —
   * иначе после каждого отчёта пришлось бы вспоминать жест заново.
   */
  const reveal = (): void => {
    if (launcher.style.visibility !== 'hidden') return;
    launcher.style.removeProperty('visibility');
    ask('haptics', (h) => h.haptics?.tap());
  };
  revealNow = reveal;

  if (mode === 'gesture') launcher.style.setProperty('visibility', 'hidden');

  const stopGesture = watchGesture(reveal);
  const stopTaps = watchTaps();
  /* Отправка и очередь приезжают ленивым куском вместе с панелью. Здесь
     остаётся одна проверка отметки: у запуска, которому нечего досылать, не
     должно быть ни лишнего запроса, ни лишнего килобайта. */
  const stopOutbox = watchPending(() => {
    void import('./send')
      .then((module) => module.flushOutbox())
      .catch((error: unknown) => console.warn('[devkit] досылка не загрузилась', error));
  });
  /* Журнал ставится сразу, до всякого жеста: ошибки, достойные отчёта,
     случились раньше, чем панель понадобилась. */
  const stopLog = installBreadcrumbs({
    console,
    addEventListener: (type, handler) => window.addEventListener(type, handler),
    removeEventListener: (type, handler) => window.removeEventListener(type, handler),
  });

  return () => {
    stopGesture();
    stopTaps();
    stopOutbox();
    stopLog();
    revealNow = undefined;
    close();
    container.remove();
  };
}
