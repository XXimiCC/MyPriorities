import { resolve } from 'node:path';

import { defineConfig } from 'vite';

import { SITE } from './site.config.js';

/**
 * Подстановка адресов в HTML на этапе сборки: в готовой странице ни одной
 * метки не остаётся, а рантайм-скрипта ради этого нет вовсе.
 *
 * Неизвестная метка роняет сборку намеренно. Опечатка в `{{APPP}}` должна
 * ронять деплой, а не уезжать на прод обычным текстом посреди страницы.
 */
function addresses() {
  return {
    name: 'landing-addresses',
    transformIndexHtml(html) {
      return html.replace(/\{\{(\w+)\}\}/g, (whole, key) => {
        if (!(key in SITE)) throw new Error(`неизвестная метка ${whole} в index.html`);
        return SITE[key];
      });
    },
  };
}

export default defineConfig({
  plugins: [addresses()],
  // Лендинг всегда живёт в корне своего домена — здесь незачем повторять
  // относительный base приложения, который существует ради переносимости
  // мини-аппа между хостингами.
  base: '/',
  build: {
    target: 'es2020',
    /*
     * Две страницы, а не одна: английская версия — это первое, что открывает
     * человек, который по-русски не читает. Без явного списка входов Vite
     * собрал бы только index.html, а en/index.html молча не доехал бы до
     * прода — с рабочей ссылкой в шапке.
     *
     * cleanUrls в vercel.json отдаёт en/index.html по адресу /en, поэтому
     * своих правил маршрутизации не нужно.
     */
    rollupOptions: {
      input: {
        ru: resolve(import.meta.dirname, 'index.html'),
        en: resolve(import.meta.dirname, 'en/index.html'),
      },
    },
  },
  server: { host: true, allowedHosts: true },
  preview: { host: true, allowedHosts: true },
});
