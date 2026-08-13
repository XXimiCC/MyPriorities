/*
 * Куда ведут ссылки в демо: в браузер или в Telegram.
 *
 * На компьютере правильный ответ — новая вкладка веб-версии: человек
 * рассматривает лендинг, и уводить его со страницы, чтобы он потом искал
 * дорогу назад, невежливо.
 *
 * На телефоне правильный ответ другой. Приложение — мини-апп, и в клиенте
 * Telegram оно и живёт: там есть кнопка «назад», ярлык на домашний экран и
 * аккаунт, которым потом включается синхронизация. Открытая в мобильном
 * Safari вкладка не даёт ничего из этого. Поэтому там ссылка ведёт в бота:
 *
 *   t.me/<бот>/app?startapp=demo_<профиль>
 *
 * `startapp` приезжает в приложение через клиент, а не адресной строкой, и
 * разбирается в src/demo/mode.ts — префикс `demo_` там уже понимают.
 *
 * Признак телефона — грубый указатель, а не ширина окна: узкое окно на
 * компьютере остаётся компьютером, и Telegram там открывать незачем.
 */

const COARSE = '(pointer: coarse)';

const links = document.querySelectorAll('[data-entry]');

if (links.length) {
  const coarse = window.matchMedia(COARSE);

  const apply = () => {
    for (const link of links) {
      const telegram = link.dataset.entryTg;
      const web = link.dataset.entryWeb;
      if (!telegram || !web) continue;

      if (coarse.matches) {
        link.href = telegram;
        // В клиент Telegram уходим текущей вкладкой: там своя навигация назад.
        link.removeAttribute('target');
        link.removeAttribute('rel');
      } else {
        link.href = web;
        link.target = '_blank';
        link.rel = 'noopener';
      }
    }
  };

  apply();
  // Подключили мышь к планшету — ссылки переобуваются на лету.
  coarse.addEventListener('change', apply);
}
