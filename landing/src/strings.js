/**
 * Строки скриптов лендинга.
 *
 * Страниц две — русская в корне и английская в /en, — а скрипты общие: копия
 * demo.js и mini.js на язык означала бы, что правку в логике надо вносить
 * дважды, и однажды её внесут один раз. Язык берётся у самой страницы:
 * `<html lang>` уже стоит правильный, потому что от него зависит перенос слов
 * и экранный диктор.
 *
 * Всё, что видно в разметке, лежит в разметке. Сюда попало только то, что
 * скрипты создают сами: подписи кнопок, aria-label и форматы чисел.
 */

const RU = {
  numberLocale: 'ru-RU',
  hour: 'ч',
  minute: 'м',
  /** Между числом и единицей: «30 м», но «30m». */
  gap: ' ',

  openDemo: 'Открыть демо',
  frameTitle: 'Демо приложения «Мои Приоритеты»',
  frameFailed: 'Демо не открылось в рамке',
  appDown: 'Приложение сейчас не отвечает',

  addBlock: (title) => `Добавить полчаса: ${title}`,
  leader: (title, percent) => `лидер: ${title}, ${percent}%`,
  nothingYet: 'пока ничего',
  hintBefore: 'Нажми «+» — это полчаса твоей жизни',
  hintAfter: 'Полоса лидера всегда во всю ширину — остальные в его долях',
};

const EN = {
  numberLocale: 'en-US',
  hour: 'h',
  minute: 'm',
  gap: '',

  openDemo: 'Open the demo',
  frameTitle: 'My Priorities app demo',
  frameFailed: 'The demo would not open in the frame',
  appDown: 'The app is not responding right now',

  addBlock: (title) => `Add half an hour: ${title}`,
  leader: (title, percent) => `leader: ${title}, ${percent}%`,
  nothingYet: 'nothing yet',
  hintBefore: 'Tap “+” — that is half an hour of your life',
  hintAfter: 'The leader’s bar is always full width, the rest are fractions of it',
};

export const L = document.documentElement.lang.startsWith('en') ? EN : RU;
