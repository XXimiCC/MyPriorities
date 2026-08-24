import { defineConfig } from 'vitepress';

/*
 * Конфиг документации «Мои Приоритеты».
 *
 * base не задан намеренно: сайт живёт отдельным проектом Vercel на корне домена.
 * srcDir тоже не задан — markdown лежит прямо в docs/, третий уровень вложенности
 * ничего не даёт при трёх десятках страниц.
 *
 * Языков два, и они неравные. Русский — весь сайт: тридцать с лишним страниц,
 * четыре раздела, справочники, собранные из кода. Английский — три входные
 * страницы: «что это», «быстрый старт» и главная. Полный перевод четырёх
 * разделов не окупается, а вход, за которым дальше идёт русский текст, —
 * окупается: он отвечает на вопрос «что это вообще такое» тому, кто иначе
 * закроет вкладку на первом же абзаце.
 *
 * Отсюда правило английского сайдбара: свои три страницы, а всё остальное —
 * ссылками в русские разделы с пометкой (RU). Читатель видит, где кончается
 * его язык, до того как туда нажмёт.
 */

const sidebar = [
  {
    text: 'Начало',
    collapsed: false,
    items: [
      { text: 'Что это такое', link: '/guide/what' },
      { text: 'Быстрый старт', link: '/guide/quick-start' },
      { text: 'Словарь', link: '/guide/glossary' },
    ],
  },
  {
    text: 'Экраны',
    collapsed: false,
    items: [
      { text: 'Первый запуск', link: '/screens/onboarding' },
      { text: 'Приоритеты', link: '/screens/home' },
      { text: 'Заряд', link: '/screens/charge' },
      { text: 'Навыки', link: '/screens/skills' },
      { text: 'Статистика', link: '/screens/stats' },
      { text: 'Настройки', link: '/screens/settings' },
      { text: 'Редактирование приоритетов', link: '/screens/edit' },
      { text: 'Наборы', link: '/screens/presets' },
      { text: 'Достижения', link: '/screens/achievements' },
      { text: 'Показать другу', link: '/screens/demo' },
    ],
  },
  {
    text: 'Как это работает',
    collapsed: false,
    items: [
      { text: 'Модули', link: '/topics/modules' },
      { text: 'Наблюдения', link: '/topics/insights' },
      { text: 'Лестница навыков', link: '/topics/skills-ladder' },
      { text: 'Справочник достижений', link: '/topics/achievements-catalogue' },
      { text: 'Обои с зарядом', link: '/topics/wallpaper' },
      { text: 'Данные и синхронизация', link: '/topics/data' },
      { text: 'Копия данных', link: '/topics/backup' },
      { text: 'Сброс', link: '/topics/reset' },
      { text: 'Пределы и лимиты', link: '/topics/limits' },
      { text: 'Только в Telegram', link: '/topics/telegram-only' },
    ],
  },
  {
    text: 'Разработка',
    collapsed: true,
    items: [
      { text: 'Локальный запуск', link: '/dev/setup' },
      { text: 'Демо-режим', link: '/dev/mock' },
      { text: 'Панель отладки', link: '/dev/devkit' },
      { text: 'Архитектура', link: '/dev/architecture' },
      { text: 'Строки интерфейса', link: '/dev/i18n' },
      { text: 'Скриншоты', link: '/dev/screenshots' },
      { text: 'Сборка и публикация', link: '/dev/release' },
      { text: 'Чек-лист проверки', link: '/dev/qa' },
      { text: 'Про эту документацию', link: '/dev/docs' },
    ],
  },
];

const sidebarEn = [
  {
    text: 'Start here',
    collapsed: false,
    items: [
      { text: 'What this is', link: '/en/guide/what' },
      { text: 'Quick start', link: '/en/guide/quick-start' },
    ],
  },
  {
    /*
     * Пометка (RU) стоит у раздела, а не у каждой ссылки: строк было бы
     * двадцать четыре, и «(RU)» в каждой читалось бы как шум, а не как
     * предупреждение.
     */
    text: 'The rest of the manual (RU)',
    collapsed: false,
    items: [
      { text: 'Screens', link: '/screens/home' },
      { text: 'How it works', link: '/topics/modules' },
      { text: 'Data and sync', link: '/topics/data' },
      { text: 'Limits', link: '/topics/limits' },
      { text: 'Development', link: '/dev/setup' },
    ],
  },
];

/** Русский перевод локального поиска. У английского свой — умолчание VitePress. */
const searchRu = {
  button: { buttonText: 'Поиск', buttonAriaLabel: 'Поиск' },
  modal: {
    displayDetails: 'Показать подробности',
    resetButtonTitle: 'Сбросить',
    backButtonTitle: 'Назад',
    noResultsText: 'Ничего не нашлось',
    footer: {
      selectText: 'выбрать',
      selectKeyAriaLabel: 'Enter',
      navigateText: 'листать',
      navigateUpKeyAriaLabel: 'вверх',
      navigateDownKeyAriaLabel: 'вниз',
      closeText: 'закрыть',
      closeKeyAriaLabel: 'Esc',
    },
  },
};

export default defineConfig({
  cleanUrls: true,
  // Битая внутренняя ссылка обязана ронять сборку: документация из тридцати
  // страниц держится на перекрёстных ссылках, и молча протухшая ссылка хуже,
  // чем упавший деплой.
  ignoreDeadLinks: false,
  // Карта сайта. Адрес нужен абсолютным — в карте сайта относительных ссылок
  // не бывает, и без него VitePress её просто не соберёт.
  sitemap: { hostname: 'https://docs.mypriorities.life' },
  // Приложение существует только в тёмном виде — светлой версии сайта быть не должно.
  appearance: 'force-dark',
  lastUpdated: true,

  head: [
    ['meta', { name: 'theme-color', content: '#000000' }],
    ['meta', { name: 'color-scheme', content: 'dark' }],
    /*
     * Панель отладки: Ctrl+Shift+Q показывает значок, значок открывает панель.
     * Опечатка в тексте страницы ловится тем же способом, что и баг в
     * приложении, — кадром с разметкой, а не пересказом по памяти.
     *
     * Файл собран заранее (`npm run devkit:sync`) и лежит в public/: сюда, в
     * отдельный проект Vercel, каталог src/ приложения не доезжает. Модуль
     * весит около трёх килобайт сжатыми; React и съёмка кадра приезжают
     * отдельным куском только при первом открытии панели.
     *
     * Тикет отсюда уходит с ключом приглашения: `?test=<ключ>` в адресе, один
     * раз на вкладку. См. /dev/devkit.
     */
    [
      'script',
      {
        type: 'module',
        src: '/devkit/devkit.js',
        'data-devkit-url': 'https://api.mypriorities.life',
        'data-devkit-app': 'docs',
      },
    ],
  ],

  markdown: {
    lineNumbers: false,
    image: { lazyLoading: true },
  },

  locales: {
    root: {
      label: 'Русский',
      lang: 'ru-RU',
      title: 'Мои Приоритеты',
      description: 'Документация Telegram Mini App «Мои Приоритеты»',
      themeConfig: {
        nav: [
          { text: 'Начало', link: '/guide/what' },
          { text: 'Экраны', link: '/screens/home' },
          { text: 'Разработка', link: '/dev/setup' },
        ],
        sidebar,
        outline: { level: [2, 3], label: 'На этой странице' },
        docFooter: { prev: 'Назад', next: 'Дальше' },
        lastUpdatedText: 'Обновлено',
        returnToTopLabel: 'Наверх',
        sidebarMenuLabel: 'Разделы',
        langMenuLabel: 'Сменить язык',
        footer: { message: 'Мои Приоритеты — Telegram Mini App, который работает и в браузере' },
      },
    },

    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      title: 'My Priorities',
      description: 'Documentation for the My Priorities Telegram Mini App',
      themeConfig: {
        nav: [
          { text: 'Start here', link: '/en/guide/what' },
          { text: 'Screens (RU)', link: '/screens/home' },
        ],
        sidebar: sidebarEn,
        outline: { level: [2, 3], label: 'On this page' },
        footer: { message: 'My Priorities — a Telegram Mini App that also works in a browser' },
      },
    },
  },

  themeConfig: {
    /*
     * Поиск общий: индекс один на сайт, и находить он должен обе локали —
     * английских страниц три, и запирать читателя внутри них означало бы
     * прятать от него всё остальное.
     */
    search: {
      provider: 'local',
      options: {
        detailedView: true,
        locales: { root: { translations: searchRu } },
      },
    },
    externalLinkIcon: true,
  },
});
