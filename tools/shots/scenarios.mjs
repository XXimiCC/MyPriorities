/*
 * Манифест снимков — единственный файл здесь, который правят руками.
 *
 * Три прогона, потому что три состояния приложения несовместимы в одном:
 *   demo  — ?mock=1, 45 дней синтетики: заполненные экраны, шторки, лимиты;
 *   empty — чистый localStorage: онбординг и все пустые состояния
 *           (в демо-режиме onboarded = true, туда просто не попасть);
 *   tg    — ?mock=1 плюс стаб Telegram: «Аккаунт Telegram», ярлык, ручное
 *           сохранение картинки — три вида, недостижимые в голом браузере.
 *
 * Подписи берутся из ru.ts через labels.mjs: переименовали строку в приложении —
 * скрипт падает на отсутствующем ключе, а не снимает молча не тот экран.
 *
 * Поля снимка:
 *   name     имя PNG в docs/public/shots (оно же ссылка в markdown)
 *   note     что именно на кадре — попадает в dev/screenshots.md
 *   setup    как довести приложение до нужного состояния
 *   target   снять только этот элемент вместо всего экрана
 *   scrollTo подкрутить экран к элементу и снять обычный кадр телефона
 *   tall     распустить раскладку и снять длинный экран целиком
 */

import { s, fmt } from './labels.mjs';

// --- Общие локаторы -------------------------------------------------------

const tabbar = (page) => page.getByRole('tablist', { name: s('app.title') });
const periods = (page) => page.getByRole('tablist', { name: s('period.label') });

const goTab = (page, key) => tabbar(page).getByRole('tab', { name: s(key) }).click();
const setPeriod = (page, key) => periods(page).getByRole('tab', { name: s(key) }).click();

const sheet = (page, title) => page.getByRole('dialog', { name: title });
const chargeOption = (page, key) =>
  page.locator('.charge__option').filter({ hasText: s(key) }).first();

/** Онбординг целиком: три слайда и первый набор. Дальше приложение пустое. */
async function completeOnboarding(page) {
  await page.getByRole('button', { name: s('onb.skip') }).click();
  await page.locator('.pcard').first().click();
  await page.getByRole('button', { name: s('presets.apply') }).click();
  await tabbar(page).waitFor();
}

/** Открывает шторку счётчика у первого приоритета. */
async function openTune(page) {
  await page.locator('.prow__main').first().click();
  await page.locator('.tune').waitFor();
}

/** Открывает экран редактирования списка. */
const openEdit = (page) => page.getByRole('button', { name: s('home.edit') }).click();

/** Добавляет приоритет с заданным названием (экран редактирования уже открыт). */
async function addPriority(page, title) {
  await page.getByRole('button', { name: s('edit.add') }).click();
  const form = sheet(page, s('edit.newTitle'));
  await form.locator('.pform__input').fill(title);
  await form.getByRole('button', { name: s('common.add') }).click();
  await form.waitFor({ state: 'detached' });
}

// --- Прогон A: демо-данные ------------------------------------------------

const demo = [
  {
    name: 'home-today',
    note: 'Вкладка «Приоритеты», период «Сегодня», отметки есть',
  },
  {
    name: 'home-week',
    note: 'Период «7 дней»: виден лидер и его доля',
    setup: (page) => setPeriod(page, 'period.week'),
  },
  {
    name: 'home-dots',
    note: 'Кроп строки: точки отмеченных блоков рядом с «+»',
    target: '.prow',
  },
  {
    name: 'home-tune-sheet',
    note: 'Шторка счётчика, блоков больше нуля',
    setup: openTune,
  },
  {
    name: 'home-tune-zero',
    note: 'Та же шторка на нуле: «−» заблокирована',
    setup: async (page) => {
      await openTune(page);
      const minus = page.getByRole('button', { name: fmt('home.minus', { minutes: 30 }) });
      // Крутим вниз до упора: сколько блоков в этом дне — зависит от данных,
      // а нужен именно нижний край, где кнопка гаснет.
      for (let i = 0; i < 40 && (await minus.isEnabled()); i += 1) await minus.click();
    },
  },
  {
    name: 'home-battery-sheet',
    note: 'Выбор заряда из шапки главного экрана',
    setup: async (page) => {
      await page.getByRole('button', { name: s('home.battery') }).click();
      await sheet(page, s('charge.sheetTitle')).waitFor();
    },
  },
  {
    name: 'home-daypicker',
    note: 'Лента четырнадцати дней, точки на заполненных',
    setup: async (page) => {
      await page.getByRole('button', { name: s('home.fillGaps') }).click();
      await page.getByRole('tablist', { name: s('home.dayPicker') }).waitFor();
    },
  },
  {
    name: 'home-past-warning',
    note: 'Выбран прошлый день: предупреждение и кнопка «К сегодня»',
    setup: async (page) => {
      await page.getByRole('button', { name: s('home.fillGaps') }).click();
      const strip = page.getByRole('tablist', { name: s('home.dayPicker') });
      // Предпоследний день ленты — вчера: сегодня стоит последним, справа.
      await strip.getByRole('tab').nth(12).click();
      await page.locator('.dpast').waitFor();
    },
  },

  {
    name: 'edit-list',
    note: 'Список с ручками перетаскивания и счётчиком в шапке',
    setup: openEdit,
    tall: true,
  },
  {
    name: 'edit-form',
    note: 'Шторка «Приоритет»: название и палитра',
    setup: async (page) => {
      await openEdit(page);
      await page.locator('.erow__body').first().click();
      await sheet(page, s('edit.formTitle')).waitFor();
    },
  },
  {
    name: 'edit-add',
    note: 'Шторка «Новый приоритет» — палитры нет, цвет назначается сам',
    setup: async (page) => {
      await openEdit(page);
      await page.getByRole('button', { name: s('edit.add') }).click();
      await sheet(page, s('edit.newTitle')).waitFor();
    },
  },
  {
    name: 'edit-limit',
    note: 'Кнопка добралась до предела: «Максимум 10 приоритетов»',
    setup: async (page) => {
      await openEdit(page);
      // Базовый набор — семь строк, до предела не хватает трёх.
      for (const title of ['Музыка', 'Родители', 'Порядок']) await addPriority(page, title);
      await page
        .getByRole('button', { name: fmt('edit.limit', { max: 10 }) })
        .waitFor();
    },
    tall: true,
  },
  {
    name: 'edit-archive',
    note: 'Архив после удаления приоритета: время не пропало',
    setup: async (page) => {
      await openEdit(page);
      const last = page.locator('.erow').last();
      const title = (await last.locator('.erow__title').innerText()).trim();
      await page.getByRole('button', { name: fmt('edit.delete', { title }) }).click();
      await page.locator('.edit__archive').waitFor();
    },
    tall: true,
  },

  {
    name: 'charge-hero',
    note: 'Герой экрана «Заряд»: батарея и сколько вы сегодня в этом состоянии',
    setup: (page) => goTab(page, 'tab.charge'),
    target: '.charge__hero',
  },
  {
    name: 'charge-list',
    note: 'Четыре состояния со временем за сегодня и разбивкой дня',
    setup: (page) => goTab(page, 'tab.charge'),
    tall: true,
  },
  {
    name: 'charge-drain-sheet',
    note: 'Вопрос «Что съело всю энергию?»: «Пропустить» ещё отсчитывает',
    setup: async (page) => {
      await goTab(page, 'tab.charge');
      // Повтор того же уровня — не событие, поэтому сначала уводим заряд вверх.
      await chargeOption(page, 'battery.3.title').click();
      await chargeOption(page, 'battery.1.title').click();
      await sheet(page, s('drain.title')).waitFor();
    },
  },
  {
    name: 'charge-drain-ready',
    note: 'Та же шторка через три секунды: «Пропустить» разблокирована',
    setup: async (page) => {
      await goTab(page, 'tab.charge');
      await chargeOption(page, 'battery.3.title').click();
      await chargeOption(page, 'battery.1.title').click();
      // Отсчёт живой: clock.setFixedTime морозит Date.now(), но не таймеры.
      await page.locator('.drain__skip:not([disabled])').waitFor({ timeout: 10_000 });
    },
  },
  {
    name: 'charge-wallpaper-sheet',
    note: 'Генератор обоев: превью, выбор уровня и размера экрана',
    setup: async (page) => {
      await goTab(page, 'tab.charge');
      await page.getByRole('button', { name: s('charge.wallpaperAction') }).click();
      // Картинка готовится асинхронно — ждём её, а не спиннер.
      await page.locator('.wp__preview img').waitFor({ timeout: 15_000 });
    },
  },

  {
    name: 'skills-list',
    note: 'Три навыка на разных ступенях лестницы, период «30 дней»',
    setup: (page) => goTab(page, 'tab.skills'),
    tall: true,
  },
  {
    name: 'skills-sheet',
    note: 'Шторка навыка: ступень, часы и сколько до следующей',
    setup: async (page) => {
      await goTab(page, 'tab.skills');
      await page.locator('.srow__main').first().click();
      await page.locator('.sksheet').waitFor();
    },
  },
  {
    name: 'skills-ladder',
    note: 'Лестница развёрнута целиком: все семнадцать ступеней',
    setup: async (page) => {
      await goTab(page, 'tab.skills');
      await page.locator('.srow__main').first().click();
      await page.getByRole('button', { name: fmt('level.expand', { count: 17 }) }).click();
    },
    scrollTo: '.sksheet__ladder',
  },
  {
    name: 'skills-link',
    note: 'Связь с приоритетом: список целей и текущая привязка',
    setup: async (page) => {
      await goTab(page, 'tab.skills');
      // Второй навык демо-данных — «Программирование», он привязан к «Работе».
      await page.locator('.srow__main').nth(1).click();
      await page.locator('.sksheet__links').waitFor();
    },
    scrollTo: '.sksheet__linked',
  },
  {
    name: 'skills-add',
    note: 'Новый навык: список или своё название, цвет, уже накопленные часы',
    setup: async (page) => {
      await goTab(page, 'tab.skills');
      await page.getByRole('button', { name: s('skills.add') }).click();
      await sheet(page, s('skills.newTitle')).waitFor();
    },
  },

  {
    name: 'stats-week',
    note: 'Плитки итогов, наблюдения и «Куда уходит время» за неделю',
    setup: (page) => goTab(page, 'tab.stats'),
  },
  {
    name: 'stats-insights',
    note: 'Блок «Что видно»: до трёх наблюдений из собственных отметок',
    setup: (page) => goTab(page, 'tab.stats'),
    target: '.ins',
  },
  {
    name: 'stats-daybars',
    note: '«По дням»: высота столбца — объём, цвета внутри — из чего сложился',
    setup: (page) => goTab(page, 'tab.stats'),
    scrollTo: '.dbars',
  },
  {
    name: 'stats-day-open',
    note: 'День разобран по приоритетам после нажатия на столбик',
    setup: async (page) => {
      await goTab(page, 'tab.stats');
      await page.locator('.dbars__col').nth(3).click();
    },
    scrollTo: '.dbars',
  },
  {
    name: 'stats-charge',
    note: 'Полоса состояний и список уровней со временем и долями',
    setup: (page) => goTab(page, 'tab.stats'),
    scrollTo: '.blist',
  },
  {
    name: 'stats-energy',
    note: '«Как менялась энергия»: линия среднего заряда и пунктир периода',
    setup: (page) => goTab(page, 'tab.stats'),
    scrollTo: '.energy',
  },
  {
    name: 'stats-drains',
    note: '«Что сажает батарею»: ответы на вопрос при переходе «на нуле»',
    setup: async (page) => {
      /*
       * Демо-данные не содержат ответов о разряде: генератор кладёт переключения
       * двухэлементными, без третьего поля. Поэтому ответ создаётся здесь —
       * иначе на кадре был бы пустой раздел, а он и так описан текстом.
       */
      await goTab(page, 'tab.charge');
      await chargeOption(page, 'battery.3.title').click();
      await chargeOption(page, 'battery.1.title').click();
      await sheet(page, s('drain.title')).waitFor();
      await page.locator('.drain__item').first().click();
      await goTab(page, 'tab.stats');
    },
    // Второй .blist на экране — причины разряда; первый занят списком состояний.
    scrollTo: '.blist >> nth=1',
  },
  {
    name: 'stats-month',
    note: 'Тот же экран за 30 дней: окно шире, картина спокойнее',
    setup: async (page) => {
      await goTab(page, 'tab.stats');
      await setPeriod(page, 'period.month');
    },
    tall: true,
  },

  {
    name: 'settings-modules',
    note: 'Три тумблера модулей и строка достижений со счётчиком',
    setup: (page) => goTab(page, 'tab.settings'),
    scrollTo: '.tgl',
  },
  {
    name: 'settings-block-price',
    note: '«Цена одного клика»: шесть значений и что даст пересчёт',
    setup: (page) => goTab(page, 'tab.settings'),
    scrollTo: '.sset__blocks',
  },
  {
    name: 'settings-data-local',
    note: 'Блок «Данные» вне Telegram: предупреждение о синхронизации',
    setup: (page) => goTab(page, 'tab.settings'),
    scrollTo: '.sset__facts',
  },
  {
    name: 'settings-reset',
    note: 'Две опасные кнопки и приписка о том, что сброс задевает облако',
    setup: (page) => goTab(page, 'tab.settings'),
    scrollTo: '.sset__danger',
  },

  {
    name: 'presets-list',
    note: 'Экран «Наборы» из настроек: у текущего набора стоит бейдж',
    setup: async (page) => {
      await goTab(page, 'tab.settings');
      await page.getByRole('button', { name: s('settings.presetsRow') }).click();
      await page.locator('.presets').waitFor();
    },
    tall: true,
  },
  {
    name: 'presets-preview',
    note: 'Предпросмотр набора: приоритеты в том порядке, в каком встанут',
    setup: async (page) => {
      await goTab(page, 'tab.settings');
      await page.getByRole('button', { name: s('settings.presetsRow') }).click();
      await page.locator('.pcard').nth(1).click();
      await page.locator('.ppreview').waitFor();
    },
  },

  {
    name: 'achievements-all',
    note: 'Сетка достижений с фильтрами и счётчиком открытых',
    setup: async (page) => {
      await goTab(page, 'tab.settings');
      await page.getByRole('button', { name: s('settings.achievementsRow') }).click();
      await page.locator('.ach__grid').first().waitFor();
    },
  },
  {
    name: 'achievements-sheet-auto',
    note: 'Карточка автоматического достижения: условие и дата',
    setup: async (page) => {
      await goTab(page, 'tab.settings');
      await page.getByRole('button', { name: s('settings.achievementsRow') }).click();
      await page.locator('.ach__card').first().click();
      await sheet(page, s('ach.title')).waitFor();
    },
  },
  {
    name: 'achievements-sheet-manual',
    note: 'Достижение из группы «Жизнь»: его отмечают руками',
    setup: async (page) => {
      await goTab(page, 'tab.settings');
      await page.getByRole('button', { name: s('settings.achievementsRow') }).click();
      await page.locator('.ach__card').filter({ hasText: s('ach.m2') }).first().click();
      await page.getByRole('button', { name: s('ach.mark') }).waitFor();
    },
  },
];

// --- Прогон B: пустое приложение -----------------------------------------

const empty = [
  { name: 'onboarding-1', note: 'Первый слайд: перекос, который приложение и показывает' },
  {
    name: 'onboarding-2',
    note: 'Второй слайд: один клик — полчаса жизни',
    setup: (page) => page.getByRole('button', { name: s('onb.next') }).click(),
  },
  {
    name: 'onboarding-3',
    note: 'Третий слайд: заряд — про вас, а не про телефон',
    setup: async (page) => {
      const next = page.getByRole('button', { name: s('onb.next') });
      await next.click();
      await next.click();
    },
  },
  {
    name: 'onboarding-presets',
    note: 'Последний шаг онбординга — выбор стартового набора',
    setup: (page) => page.getByRole('button', { name: s('onb.skip') }).click(),
    tall: true,
  },
  {
    name: 'home-empty',
    note: 'Приоритеты есть, отметок ещё нет: объяснение цены клика',
    setup: completeOnboarding,
  },
  {
    name: 'home-battery-unset',
    note: 'Кроп шапки: заряд ещё не отмечен',
    setup: completeOnboarding,
    target: '.header',
  },
  {
    name: 'charge-unset',
    note: 'Заряд ни разу не отмечался: батарея приглушена',
    setup: async (page) => {
      await completeOnboarding(page);
      await goTab(page, 'tab.charge');
    },
  },
  {
    name: 'skills-empty',
    note: 'Ни одного навыка: что такое навык и зачем вписывать накопленное',
    setup: async (page) => {
      await completeOnboarding(page);
      await goTab(page, 'tab.skills');
    },
  },
  {
    name: 'stats-empty',
    note: 'За период ничего не отмечено — и заряд тоже',
    setup: async (page) => {
      await completeOnboarding(page);
      await goTab(page, 'tab.stats');
    },
    tall: true,
  },
  {
    name: 'achievements-empty',
    note: 'Фильтр «Открытые» на пустой истории',
    setup: async (page) => {
      await completeOnboarding(page);
      await goTab(page, 'tab.settings');
      await page.getByRole('button', { name: s('settings.achievementsRow') }).click();
      await page
        .getByRole('tablist', { name: s('ach.title') })
        .getByRole('tab', { name: s('ach.filterDone') })
        .click();
    },
  },
];

// --- Прогон C: клиент Telegram -------------------------------------------

const telegram = [
  {
    name: 'settings-data-cloud',
    note: 'Тот же блок «Данные» в настоящем клиенте: «Аккаунт Telegram»',
    setup: (page) => goTab(page, 'tab.settings'),
    scrollTo: '.sset__facts',
  },
  {
    name: 'settings-home-screen',
    note: 'Кнопка ярлыка на главный экран — её видно только в клиенте 8.0+',
    setup: (page) => goTab(page, 'tab.settings'),
    scrollTo: '.sset__file',
  },
  {
    name: 'charge-wallpaper-manual',
    note: 'Клиент не даёт сохранять файлы: картинку забирают долгим нажатием',
    setup: async (page) => {
      await goTab(page, 'tab.charge');
      await page.getByRole('button', { name: s('charge.wallpaperAction') }).click();
      await page.locator('.wp__preview img').waitFor({ timeout: 15_000 });
      await page.getByRole('button', { name: s('wallpaper.save') }).click();
      await page.locator('.wp__manual').waitFor();
    },
  },
];

export const RUNS = [
  { id: 'demo', url: '/?mock=1', shots: demo },
  { id: 'empty', url: '/', shots: empty },
  { id: 'tg', url: '/?mock=1', telegram: true, shots: telegram },
];
