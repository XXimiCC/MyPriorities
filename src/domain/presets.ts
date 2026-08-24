/**
 * Готовые наборы приоритетов — «сборники» с главного экрана. У каждого свой
 * типаж, иконка и акцент; по картинке должно быть понятно, что у этого
 * человека во главе угла.
 *
 * Идентификаторы приоритетов здесь не хранятся намеренно: при применении
 * набора они подбираются по названию из уже существующих и архивных, чтобы
 * «Работа» осталась той же самой «Работой» и не потеряла историю.
 *
 * Названия — ключи строк, а не слова: набор один, а языков два. Разворачивает
 * их titlesOf() в тот момент, когда они попадают на экран или в данные.
 */

import { t, type StringKey } from '../i18n';

export interface PresetPriority {
  titleKey: StringKey;
  colorId: number;
}

export interface Preset {
  id: string;
  nameKey: StringKey;
  taglineKey: StringKey;
  /** Акцент карточки — берётся из NEON_PALETTE по индексу. */
  accentId: number;
  /** Штрихованные пути в системе координат 24×24. */
  icon: string[];
  priorities: PresetPriority[];
}

/**
 * Названия готовыми строками — на языке, который сейчас на экране.
 *
 * Дальше слово живёт в данных обычной строкой: приоритет, созданный из набора,
 * ничем не отличается от вписанного руками, и смена языка его не переименует.
 */
export function titlesOf(items: PresetPriority[]): Array<{ title: string; colorId: number }> {
  return items.map(({ titleKey, colorId }) => ({ title: t(titleKey), colorId }));
}

/** Стартовый набор. Он же первая карточка сборников — отдельной кнопки под ним не нужно. */
export const DEFAULT_PRIORITIES: PresetPriority[] = [
  { titleKey: 'word.work', colorId: 1 },
  { titleKey: 'word.family', colorId: 9 },
  { titleKey: 'word.health', colorId: 0 },
  { titleKey: 'word.growth', colorId: 3 },
  { titleKey: 'word.finance', colorId: 7 },
  { titleKey: 'word.friends', colorId: 4 },
  { titleKey: 'word.rest', colorId: 6 },
];

export const BASIC_PRESET_ID = 'basic';

export const PRESETS: Preset[] = [
  {
    id: BASIC_PRESET_ID,
    nameKey: 'preset.basic',
    taglineKey: 'preset.basic.note',
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
    nameKey: 'preset.family',
    taglineKey: 'preset.family.note',
    accentId: 9,
    icon: [
      'M8.5 11a3 3 0 100-6 3 3 0 000 6',
      'M17 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5',
      'M2.5 20v-1.5A4.5 4.5 0 017 14h3a4.5 4.5 0 014.5 4.5V20',
      'M16 20v-1.4a3.6 3.6 0 013.6-3.6 2.6 2.6 0 012.4 1.6',
    ],
    priorities: [
      { titleKey: 'word.family', colorId: 9 },
      { titleKey: 'word.kids', colorId: 4 },
      { titleKey: 'word.home', colorId: 6 },
      { titleKey: 'word.work', colorId: 2 },
      { titleKey: 'word.health', colorId: 0 },
      { titleKey: 'word.relationships', colorId: 5 },
      { titleKey: 'word.rest', colorId: 1 },
    ],
  },
  {
    id: 'founder',
    nameKey: 'preset.founder',
    taglineKey: 'preset.founder.note',
    accentId: 6,
    icon: [
      'M12 2.5c3.2 2.6 4.8 6.2 4.8 9.8L12 17l-4.8-4.7c0-3.6 1.6-7.2 4.8-9.8z',
      'M12 11a1.7 1.7 0 100-3.4A1.7 1.7 0 0012 11z',
      'M8.2 13.6L5.6 16l.7 3.4 3-1.7',
      'M15.8 13.6L18.4 16l-.7 3.4-3-1.7',
    ],
    priorities: [
      { titleKey: 'word.product', colorId: 6 },
      { titleKey: 'word.sales', colorId: 0 },
      { titleKey: 'word.team', colorId: 1 },
      { titleKey: 'word.finance', colorId: 7 },
      { titleKey: 'word.learning', colorId: 3 },
      { titleKey: 'word.health', colorId: 8 },
      { titleKey: 'word.rest', colorId: 2 },
    ],
  },
  {
    id: 'athlete',
    nameKey: 'preset.athlete',
    taglineKey: 'preset.athlete.note',
    accentId: 0,
    icon: ['M3.5 9.5v5', 'M7 7v10', 'M17 7v10', 'M20.5 9.5v5', 'M7 12h10'],
    priorities: [
      { titleKey: 'word.training', colorId: 0 },
      { titleKey: 'word.nutrition', colorId: 8 },
      { titleKey: 'word.sleep', colorId: 2 },
      { titleKey: 'word.recovery', colorId: 1 },
      { titleKey: 'word.work', colorId: 3 },
      { titleKey: 'word.loved', colorId: 9 },
      { titleKey: 'word.rest', colorId: 6 },
    ],
  },
  {
    id: 'student',
    nameKey: 'preset.student',
    taglineKey: 'preset.student.note',
    accentId: 2,
    icon: [
      'M2.5 9L12 5l9.5 4-9.5 4-9.5-4z',
      'M6.5 11.2v4.3c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-4.3',
      'M21.5 9v5.5',
    ],
    priorities: [
      { titleKey: 'word.studies', colorId: 2 },
      { titleKey: 'word.projects', colorId: 6 },
      { titleKey: 'word.languages', colorId: 3 },
      { titleKey: 'word.sport', colorId: 0 },
      { titleKey: 'word.friends', colorId: 4 },
      { titleKey: 'word.sleep', colorId: 1 },
      { titleKey: 'word.rest', colorId: 7 },
    ],
  },
  {
    id: 'creator',
    nameKey: 'preset.creator',
    taglineKey: 'preset.creator.note',
    accentId: 4,
    icon: [
      'M12 2.5l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5-5.5-2 5.5-2z',
      'M18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z',
    ],
    priorities: [
      { titleKey: 'word.creativity', colorId: 4 },
      { titleKey: 'word.inspiration', colorId: 3 },
      { titleKey: 'word.craft', colorId: 1 },
      { titleKey: 'word.audience', colorId: 6 },
      { titleKey: 'word.money', colorId: 7 },
      { titleKey: 'word.body', colorId: 0 },
      { titleKey: 'word.rest', colorId: 2 },
    ],
  },
  {
    id: 'career',
    nameKey: 'preset.career',
    taglineKey: 'preset.career.note',
    accentId: 1,
    icon: ['M3.5 20h17', 'M5.5 16.5l4.5-5.5 3.5 3 5-6.5', 'M14.5 7.5H18.5V11.5'],
    priorities: [
      { titleKey: 'word.work', colorId: 1 },
      { titleKey: 'word.skills', colorId: 2 },
      { titleKey: 'word.networking', colorId: 6 },
      { titleKey: 'word.reputation', colorId: 7 },
      { titleKey: 'word.health', colorId: 0 },
      { titleKey: 'word.family', colorId: 9 },
      { titleKey: 'word.rest', colorId: 3 },
    ],
  },
  {
    id: 'inward',
    nameKey: 'preset.inward',
    taglineKey: 'preset.inward.note',
    accentId: 3,
    icon: [
      'M12 6.5a2 2 0 100-4 2 2 0 000 4',
      'M12 8.5c-2.4 0-3.8 2-3.8 4.4 0 1 .2 1.9.6 2.7',
      'M12 8.5c2.4 0 3.8 2 3.8 4.4 0 1-.2 1.9-.6 2.7',
      'M4 18.5c2.2-1.7 5.2-2.6 8-2.6s5.8.9 8 2.6',
    ],
    priorities: [
      { titleKey: 'word.meditation', colorId: 3 },
      { titleKey: 'word.reading', colorId: 2 },
      { titleKey: 'word.journal', colorId: 1 },
      { titleKey: 'word.nature', colorId: 0 },
      { titleKey: 'word.body', colorId: 8 },
      { titleKey: 'word.loved', colorId: 9 },
      { titleKey: 'word.quiet', colorId: 4 },
    ],
  },
  {
    id: 'balance',
    nameKey: 'preset.balance',
    taglineKey: 'preset.balance.note',
    accentId: 8,
    icon: [
      'M12 3.5v16',
      'M5 19.5h14',
      'M4 8h16',
      'M4 8l-2.2 5a3 3 0 004.4 0z',
      'M20 8l2.2 5a3 3 0 01-4.4 0z',
    ],
    priorities: [
      { titleKey: 'word.work', colorId: 1 },
      { titleKey: 'word.family', colorId: 9 },
      { titleKey: 'word.health', colorId: 0 },
      { titleKey: 'word.friends', colorId: 4 },
      { titleKey: 'word.growth', colorId: 3 },
      { titleKey: 'word.finance', colorId: 7 },
      { titleKey: 'word.rest', colorId: 6 },
    ],
  },
  {
    id: 'recovery',
    nameKey: 'preset.recovery',
    taglineKey: 'preset.recovery.note',
    accentId: 7,
    icon: [
      'M20 3.5C11 3.5 5 8.2 5 14.8a5 5 0 007.6 4.3C18.2 16.3 20 10.2 20 3.5z',
      'M7.5 18c2.2-4.4 6-7.7 10.5-9.2',
    ],
    priorities: [
      { titleKey: 'word.sleep', colorId: 2 },
      { titleKey: 'word.body', colorId: 0 },
      { titleKey: 'word.nature', colorId: 8 },
      { titleKey: 'word.quiet', colorId: 3 },
      { titleKey: 'word.loved', colorId: 9 },
      { titleKey: 'word.therapy', colorId: 4 },
      { titleKey: 'word.work', colorId: 1 },
    ],
  },
];

export function findPreset(id: string | undefined): Preset | undefined {
  return id ? PRESETS.find((p) => p.id === id) : undefined;
}
