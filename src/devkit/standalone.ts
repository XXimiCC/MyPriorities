/**
 * Вход для обычных сайтов: документации и лендинга.
 *
 * У них нет ни приложения, ни стора, ни Telegram — только страница. Поэтому
 * адаптер здесь состоит из трёх обязательных полей и маршрута, а всё остальное
 * панель добирает сама из браузера.
 *
 * Настройка читается с тега скрипта, а не зашивается в сборку: один и тот же
 * файл лежит на двух сайтах и отличается ровно двумя атрибутами.
 *
 *   <script type="module" src="/devkit/devkit.js"
 *           data-devkit-url="https://api.mypriorities.life"
 *           data-devkit-app="docs"></script>
 *
 * Входа на этих сайтах нет и быть не может, поэтому тикет отсюда уходит только
 * с ключом приглашения — `?test=<ключ>` в адресе. Ключ запоминается на вкладку
 * (см. invite.ts), так что открыть с ним нужно лишь одну страницу.
 */

import { mountDevkit } from './mount';

declare const __DEVKIT_BUILD__: string;
declare const __DEVKIT_TIME__: string;

const tag = document.querySelector<HTMLElement>('script[data-devkit-url]');

mountDevkit({
  endpoint: tag?.dataset.devkitUrl ?? '',
  app: tag?.dataset.devkitApp ?? 'site',
  build: { id: __DEVKIT_BUILD__, time: __DEVKIT_TIME__ },
  // На многостраничном сайте адрес страницы — это и есть «где я стоял».
  route: () => window.location.pathname,
  /* Корень документа, а не body: у body высота во весь текст, а прокручивается
     здесь именно documentElement — от него же берётся и высота окна. */
  captureRoot: () => document.documentElement,
  client: () => ({ standalone: true }),
  flags: () => ({ printing: window.matchMedia('print').matches }),
});
