/**
 * Девять готовых наборов приоритетов — «сборники» с главного экрана.
 * У каждого свой типаж, иконка и акцент; по картинке должно быть понятно,
 * что у этого человека во главе угла.
 *
 * Идентификаторы приоритетов здесь не хранятся намеренно: при применении
 * набора они подбираются по названию из уже существующих и архивных, чтобы
 * «Работа» осталась той же самой «Работой» и не потеряла историю.
 */

export interface PresetPriority {
  title: string;
  colorId: number;
}

export interface Preset {
  id: string;
  name: string;
  tagline: string;
  /** Акцент карточки — берётся из NEON_PALETTE по индексу. */
  accentId: number;
  /** Штрихованные пути в системе координат 24×24. */
  icon: string[];
  priorities: PresetPriority[];
}

/** Стартовый набор. Он же первая карточка сборников — отдельной кнопки под ним не нужно. */
export const DEFAULT_PRIORITIES: PresetPriority[] = [
  { title: 'Работа', colorId: 1 },
  { title: 'Семья', colorId: 9 },
  { title: 'Здоровье', colorId: 0 },
  { title: 'Развитие', colorId: 3 },
  { title: 'Финансы', colorId: 7 },
  { title: 'Друзья', colorId: 4 },
  { title: 'Отдых', colorId: 6 },
];

export const BASIC_PRESET_ID = 'basic';

export const PRESETS: Preset[] = [
  {
    id: BASIC_PRESET_ID,
    name: 'Базовый',
    tagline: 'Ровный старт: семь опор без перекоса',
    accentId: 8,
    icon: [
      'M12 21a9 9 0 100-18 9 9 0 000 18',
      'M12 16a4 4 0 100-8 4 4 0 000 8',
      'M12 3v3M12 18v3M3 12h3M18 12h3',
    ],
    priorities: DEFAULT_PRIORITIES,
  },
  {
    id: 'family',
    name: 'Семьянин',
    tagline: 'Дом, дети и близкие впереди всего',
    accentId: 9,
    icon: [
      'M8.5 11a3 3 0 100-6 3 3 0 000 6',
      'M17 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5',
      'M2.5 20v-1.5A4.5 4.5 0 017 14h3a4.5 4.5 0 014.5 4.5V20',
      'M16 20v-1.4a3.6 3.6 0 013.6-3.6 2.6 2.6 0 012.4 1.6',
    ],
    priorities: [
      { title: 'Семья', colorId: 9 },
      { title: 'Дети', colorId: 4 },
      { title: 'Дом', colorId: 6 },
      { title: 'Работа', colorId: 2 },
      { title: 'Здоровье', colorId: 0 },
      { title: 'Отношения', colorId: 5 },
      { title: 'Отдых', colorId: 1 },
    ],
  },
  {
    id: 'founder',
    name: 'Основатель',
    tagline: 'Продукт, продажи и команда каждый день',
    accentId: 6,
    icon: [
      'M12 2.5c3.2 2.6 4.8 6.2 4.8 9.8L12 17l-4.8-4.7c0-3.6 1.6-7.2 4.8-9.8z',
      'M12 11a1.7 1.7 0 100-3.4A1.7 1.7 0 0012 11z',
      'M8.2 13.6L5.6 16l.7 3.4 3-1.7',
      'M15.8 13.6L18.4 16l-.7 3.4-3-1.7',
    ],
    priorities: [
      { title: 'Продукт', colorId: 6 },
      { title: 'Продажи', colorId: 0 },
      { title: 'Команда', colorId: 1 },
      { title: 'Финансы', colorId: 7 },
      { title: 'Обучение', colorId: 3 },
      { title: 'Здоровье', colorId: 8 },
      { title: 'Отдых', colorId: 2 },
    ],
  },
  {
    id: 'athlete',
    name: 'Атлет',
    tagline: 'Тело как главный проект',
    accentId: 0,
    icon: ['M3.5 9.5v5', 'M7 7v10', 'M17 7v10', 'M20.5 9.5v5', 'M7 12h10'],
    priorities: [
      { title: 'Тренировки', colorId: 0 },
      { title: 'Питание', colorId: 8 },
      { title: 'Сон', colorId: 2 },
      { title: 'Восстановление', colorId: 1 },
      { title: 'Работа', colorId: 3 },
      { title: 'Близкие', colorId: 9 },
      { title: 'Отдых', colorId: 6 },
    ],
  },
  {
    id: 'student',
    name: 'Студент',
    tagline: 'Учиться быстрее, чем меняется мир',
    accentId: 2,
    icon: [
      'M2.5 9L12 5l9.5 4-9.5 4-9.5-4z',
      'M6.5 11.2v4.3c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-4.3',
      'M21.5 9v5.5',
    ],
    priorities: [
      { title: 'Учёба', colorId: 2 },
      { title: 'Проекты', colorId: 6 },
      { title: 'Языки', colorId: 3 },
      { title: 'Спорт', colorId: 0 },
      { title: 'Друзья', colorId: 4 },
      { title: 'Сон', colorId: 1 },
      { title: 'Отдых', colorId: 7 },
    ],
  },
  {
    id: 'creator',
    name: 'Творец',
    tagline: 'Делать своё и показывать это людям',
    accentId: 4,
    icon: [
      'M12 2.5l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5-5.5-2 5.5-2z',
      'M18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z',
    ],
    priorities: [
      { title: 'Творчество', colorId: 4 },
      { title: 'Насмотренность', colorId: 3 },
      { title: 'Ремесло', colorId: 1 },
      { title: 'Аудитория', colorId: 6 },
      { title: 'Деньги', colorId: 7 },
      { title: 'Тело', colorId: 0 },
      { title: 'Отдых', colorId: 2 },
    ],
  },
  {
    id: 'career',
    name: 'Карьера',
    tagline: 'Расти в профессии и быть на виду',
    accentId: 1,
    icon: ['M3.5 20h17', 'M5.5 16.5l4.5-5.5 3.5 3 5-6.5', 'M14.5 7.5H18.5V11.5'],
    priorities: [
      { title: 'Работа', colorId: 1 },
      { title: 'Навыки', colorId: 2 },
      { title: 'Нетворкинг', colorId: 6 },
      { title: 'Репутация', colorId: 7 },
      { title: 'Здоровье', colorId: 0 },
      { title: 'Семья', colorId: 9 },
      { title: 'Отдых', colorId: 3 },
    ],
  },
  {
    id: 'inward',
    name: 'Путь внутрь',
    tagline: 'Тишина, практика и честность с собой',
    accentId: 3,
    icon: [
      'M12 6.5a2 2 0 100-4 2 2 0 000 4',
      'M12 8.5c-2.4 0-3.8 2-3.8 4.4 0 1 .2 1.9.6 2.7',
      'M12 8.5c2.4 0 3.8 2 3.8 4.4 0 1-.2 1.9-.6 2.7',
      'M4 18.5c2.2-1.7 5.2-2.6 8-2.6s5.8.9 8 2.6',
    ],
    priorities: [
      { title: 'Медитация', colorId: 3 },
      { title: 'Чтение', colorId: 2 },
      { title: 'Дневник', colorId: 1 },
      { title: 'Природа', colorId: 0 },
      { title: 'Тело', colorId: 8 },
      { title: 'Близкие', colorId: 9 },
      { title: 'Тишина', colorId: 4 },
    ],
  },
  {
    id: 'balance',
    name: 'Баланс',
    tagline: 'Ровно по всем фронтам, без перекосов',
    accentId: 8,
    icon: [
      'M12 3.5v16',
      'M5 19.5h14',
      'M4 8h16',
      'M4 8l-2.2 5a3 3 0 004.4 0z',
      'M20 8l2.2 5a3 3 0 01-4.4 0z',
    ],
    priorities: [
      { title: 'Работа', colorId: 1 },
      { title: 'Семья', colorId: 9 },
      { title: 'Здоровье', colorId: 0 },
      { title: 'Друзья', colorId: 4 },
      { title: 'Развитие', colorId: 3 },
      { title: 'Финансы', colorId: 7 },
      { title: 'Отдых', colorId: 6 },
    ],
  },
  {
    id: 'recovery',
    name: 'Восстановление',
    tagline: 'Выбраться из выгорания и собрать себя',
    accentId: 7,
    icon: [
      'M20 3.5C11 3.5 5 8.2 5 14.8a5 5 0 007.6 4.3C18.2 16.3 20 10.2 20 3.5z',
      'M7.5 18c2.2-4.4 6-7.7 10.5-9.2',
    ],
    priorities: [
      { title: 'Сон', colorId: 2 },
      { title: 'Тело', colorId: 0 },
      { title: 'Природа', colorId: 8 },
      { title: 'Тишина', colorId: 3 },
      { title: 'Близкие', colorId: 9 },
      { title: 'Терапия', colorId: 4 },
      { title: 'Работа', colorId: 1 },
    ],
  },
];

export function findPreset(id: string | undefined): Preset | undefined {
  return id ? PRESETS.find((p) => p.id === id) : undefined;
}
