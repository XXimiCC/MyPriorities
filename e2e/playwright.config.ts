/*
 * Сквозные проверки: приложение поднимается собранным и проходится как человеком.
 *
 * Конфиг живёт здесь, а не в корне, вместе со своим package.json: Playwright
 * тянет браузеры, и в корневых зависимостях они добавились бы к каждой сборке
 * на Vercel. Тот же приём, что у tools/shots — см. комментарий в его package.json.
 *
 * Приложение поднимается собранным (vite preview), а не dev-сервером, по той же
 * причине, что и при съёмке: в dev висит клиент HMR со своим оверлеем ошибок,
 * и проверяется тогда не то, что уедет на прод.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** Свой порт: 4173 занимает съёмка документации, и два прогона рядом не столкнутся. */
const PORT = 4176;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: path.join(HERE, 'tests'),
  /*
   * Прогоны параллельны, но каждый тест получает свой контекст браузера, а с ним
   * свои IndexedDB и localStorage. Записывающие тесты поэтому не видят друг друга
   * даже на одном и том же порту.
   */
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  /* Настоящих ожиданий тут нет — только autoretry локаторов, — но десять секунд
     на медленной машине под первой отрисовкой собранного бандла лишними не бывают. */
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    /*
     * Телефон, под который приложение нарисовано: оно уезжает мини-аппом, и
     * настольная ширина в нём не встречается. Размер тот же, что у съёмки.
     */
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    /*
     * Часовой пояс прибит: dayKey() считает локальную дату, и на машине в другом
     * поясе «сегодня» разъехалось бы с ожиданиями. Момент времени фиксируется в
     * fixtures.ts — там же написано, почему.
     */
    timezoneId: 'Europe/Moscow',
    colorScheme: 'dark',
    // Приложение само схлопывает переходы до 0.01 мс в @media (prefers-reduced-motion).
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  /*
   * Сборка входит в команду: прогон обязан проверять то, что уедет на прод, а не
   * то, что осталось в dist/ с прошлого раза. reuseExistingServer выключен по той
   * же причине — иначе случайно открытый preview подсунул бы старую сборку.
   */
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    cwd: ROOT,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
