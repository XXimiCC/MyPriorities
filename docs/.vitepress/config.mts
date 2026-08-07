import { defineConfig } from 'vitepress';

/*
 * Конфиг документации «Мои Приоритеты».
 *
 * base не задан намеренно: сайт живёт отдельным проектом Vercel на корне домена.
 * srcDir тоже не задан — markdown лежит прямо в docs/, третий уровень вложенности
 * ничего не даёт при трёх десятках страниц.
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
      { text: 'Архитектура', link: '/dev/architecture' },
      { text: 'Строки интерфейса', link: '/dev/i18n' },
      { text: 'Скриншоты', link: '/dev/screenshots' },
      { text: 'Сборка и публикация', link: '/dev/release' },
      { text: 'Чек-лист проверки', link: '/dev/qa' },
      { text: 'Про эту документацию', link: '/dev/docs' },
    ],
  },
];

export default defineConfig({
  lang: 'ru-RU',
  title: 'Мои Приоритеты',
  description: 'Документация Telegram Mini App «Мои Приоритеты»',

  cleanUrls: true,
  // Битая внутренняя ссылка обязана ронять сборку: документация из тридцати
  // страниц держится на перекрёстных ссылках, и молча протухшая ссылка хуже,
  // чем упавший деплой.
  ignoreDeadLinks: false,
  // Приложение существует только в тёмном виде — светлой версии сайта быть не должно.
  appearance: 'force-dark',
  lastUpdated: true,

  head: [
    ['meta', { name: 'theme-color', content: '#000000' }],
    ['meta', { name: 'color-scheme', content: 'dark' }],
  ],

  markdown: {
    lineNumbers: false,
    image: { lazyLoading: true },
  },

  themeConfig: {
    nav: [
      { text: 'Начало', link: '/guide/what' },
      { text: 'Экраны', link: '/screens/home' },
      { text: 'Разработка', link: '/dev/setup' },
    ],
    sidebar,

    search: {
      provider: 'local',
      options: {
        detailedView: true,
        translations: {
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
        },
      },
    },

    outline: { level: [2, 3], label: 'На этой странице' },
    docFooter: { prev: 'Назад', next: 'Дальше' },
    lastUpdatedText: 'Обновлено',
    returnToTopLabel: 'Наверх',
    sidebarMenuLabel: 'Разделы',
    externalLinkIcon: true,
    footer: { message: 'Мои Приоритеты — Telegram Mini App без бэкенда' },
  },
});
