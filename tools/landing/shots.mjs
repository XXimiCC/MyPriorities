/**
 * Кадры документации, которые переиспользует лендинг.
 *
 * Список отдельным модулем, а не строкой в скрипте: его читают и синхронизация
 * (tools/landing/sync.mjs), и сторож (tools/landing.test.ts). Два списка одних
 * и тех же имён однажды разошлись бы, и разошлись бы молча.
 *
 * Кадры именно копируются в landing/public/shots/, а не берутся из docs/:
 * при Root Directory = landing Vercel не видит файлы вне каталога.
 */
/*
 * Только полноэкранные кадры 780×1688. Часть кадров документации — кропы
 * отдельных блоков (`charge-hero`, `stats-insights`, `home-dots`); в рамке
 * телефона на лендинге они выглядели бы поломанной вёрсткой, а не экраном.
 */
export const LANDING_SHOTS = [
  'home-today.png',
  'charge-list.png',
  'skills-list.png',
  'stats-week.png',
  'stats-drains.png',
  /*
   * Именно `-full`, а не `achievements-all`: тот снимается на профиле «Артём»,
   * где открыто три отметки из семидесяти пяти, и продаёт пустой экран.
   */
  'achievements-full.png',
];

/** Что ещё держится копией: путь в репозитории → путь внутри landing/. */
export const LANDING_COPIES = [['src/styles/tokens.css', 'src/tokens.css']];
