/*
 * Живое приложение в рамке телефона — сразу, без клика, но только на широком
 * экране.
 *
 * Почему не на телефоне: вложенная прокручиваемая область на сенсорном экране
 * забирает жест себе, и страница перестаёт скроллиться пальцем. Никакое
 * встроенное приложение этого не стоит. Там вместо фрейма стоит свой маленький
 * пример на четыре приоритета — src/mini.js.
 *
 * Автозапуск на десктопе стоит денег: приложение это ~350 КБ бандла плюс SDK
 * Telegram со стороннего домена, и платит их каждый, кто открыл страницу.
 * Плата принята сознательно — рамка в герое и есть главный аргумент лендинга,
 * а живое приложение убеждает лучше любого текста рядом с ним. Постер под
 * фреймом остаётся: он рисуется мгновенно, держит LCP и стоит на месте, пока
 * фрейм поднимается.
 *
 * Загрузку откладываем до простоя (requestIdleCallback), чтобы фрейм не отнимал
 * сеть у собственных стилей и кадров страницы.
 *
 * Фрейм без transform: scale(): в рамке ровно 390 точек — родная ширина
 * приложения, и текст остаётся векторно чётким. Масштабирование сделало бы
 * живое демо мыльнее статичных кадров ниже.
 *
 * Не поднялось — возвращается постер, а на его месте появляется ссылка в новую
 * вкладку: молча пустой прямоугольник в герое хуже честной ссылки.
 */

/** Та же граница, на которой в landing.css рамка сменяется примером. */
const WIDE = '(min-width: 860px)';

/** Сколько ждём загрузки, прежде чем признать, что не вышло. */
const PATIENCE_MS = 8000;

const slot = document.querySelector('[data-demo-frame]');

if (slot) {
  const screen = slot.querySelector('.phone__screen');
  const veil = slot.querySelector('.phone__veil');
  const reload = slot.querySelector('[data-demo-reload]');

  let frame = null;
  let timer = 0;

  function giveUp(note) {
    window.clearTimeout(timer);
    if (frame) {
      frame.remove();
      frame = null;
    }
    slot.classList.remove("slot--live");
    if (!veil) return;

    veil.hidden = false;
    veil.innerHTML = '';

    const link = document.createElement('a');
    link.className = 'btn btn--go press';
    link.href = slot.dataset.away;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Открыть демо';

    const hint = document.createElement('p');
    hint.className = 'phone__hint';
    hint.textContent = note;

    veil.append(link, hint);
  }

  function mount() {
    frame = document.createElement('iframe');
    frame.className = 'phone__frame';
    frame.title = 'Демо приложения «Мои Приоритеты»';
    frame.src = slot.dataset.src;
    /*
     * allow-same-origin выдан потому, что приложению нужен собственный origin:
     * без него у него нет ни хранилища, ни crypto, и оно не стартует. Прав
     * относительно лендинга это фрейму не даёт — origin у него чужой.
     * allow-top-navigation не выдан намеренно: демо не может увести страницу.
     */
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.setAttribute('allow', '');

    /*
     * Таймер ловит зависшую загрузку, но не отказ в показе: браузер рисует в
     * отказавшем фрейме свою страницу ошибки и всё равно шлёт `load`, а
     * заглянуть внутрь чужого origin нельзя. Поэтому от X-Frame-Options и
     * CSP frame-ancestors на приложении надо просто воздержаться —
     * см. docs/dev/release.md.
     */
    timer = window.setTimeout(() => giveUp('Демо не открылось в рамке'), PATIENCE_MS);
    frame.addEventListener(
      'load',
      () => {
        window.clearTimeout(timer);
        // Видимость строки под рамкой ведёт класс, см. .slot--live в landing.css.
        slot.classList.add('slot--live');
      },
      { once: true },
    );

    screen.append(frame);
    if (veil) veil.hidden = true;
  }

  async function start() {
    if (frame || !slot.dataset.src || !screen) return;

    /*
     * Пробный запрос до фрейма. Он единственный отличает «приложение не
     * отвечает» от «приложение открылось»: у фрейма это неразличимо, а здесь
     * недоступный адрес честно роняет промис. Ответ не читается — no-cors,
     * нам нужен сам факт, что на том конце кто-то есть.
     */
    try {
      await fetch(slot.dataset.src, { mode: 'no-cors', cache: 'no-store' });
    } catch {
      giveUp('Приложение сейчас не отвечает');
      return;
    }

    mount();
  }

  const idle = window.requestIdleCallback ?? ((fn) => window.setTimeout(fn, 300));
  const wide = window.matchMedia(WIDE);

  const maybeStart = () => {
    if (!wide.matches) return;
    idle(() => void start(), { timeout: 2500 });
  };

  maybeStart();
  // Поворот планшета переводит через границу — тогда фрейм и поднимается.
  wide.addEventListener('change', maybeStart);

  reload?.addEventListener('click', () => {
    if (frame) frame.src = slot.dataset.src;
  });
}
