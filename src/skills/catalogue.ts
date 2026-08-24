/**
 * Подсказки при добавлении навыка.
 *
 * Пустое поле ввода — худший экран для того, кто заводит первый навык:
 * «навык» слишком широкое слово, и человек застревает не на выборе, а на
 * формулировке. Готовый список снимает этот ступор и заодно задаёт масштаб —
 * сюда попало только то, во что действительно вкладывают годы.
 *
 * Названия — ключи строк, как и в наборах приоритетов: список один, а языков
 * два. Разворачиваются они при отрисовке, а в данные попадают уже словом.
 */

import { t, type StringKey } from '../i18n';

export interface SkillGroup {
  /** Заголовок раздела в списке подсказок. */
  titleKey: StringKey;
  titles: StringKey[];
}

export const SKILL_SUGGESTIONS: SkillGroup[] = [
  {
    titleKey: 'word.g.languages',
    titles: ['word.english', 'word.spanish', 'word.german', 'word.french', 'word.chinese'],
  },
  {
    titleKey: 'word.g.craft',
    titles: [
      'word.coding',
      'word.design',
      'word.copywriting',
      'word.analytics',
      'word.sales',
      'word.speaking',
      'word.photography',
      'word.videoEditing',
      'word.graphics3d',
    ],
  },
  {
    titleKey: 'word.g.music',
    titles: ['word.guitar', 'word.piano', 'word.drums', 'word.vocals', 'word.musicProduction'],
  },
  {
    titleKey: 'word.g.body',
    titles: [
      'word.running',
      'word.swimming',
      'word.strength',
      'word.yoga',
      'word.martialArts',
      'word.dancing',
      'word.climbing',
    ],
  },
  {
    titleKey: 'word.g.mind',
    titles: ['word.reading', 'word.chess', 'word.math', 'word.investing', 'word.meditation', 'word.writing'],
  },
  {
    titleKey: 'word.g.hands',
    titles: ['word.cooking', 'word.drawing', 'word.woodwork', 'word.driving', 'word.gardening'],
  },
];

/**
 * Плоский список готовыми строками — для проверки, что название уже занято.
 *
 * Функция, а не константа: список зависит от языка, а модуль вычисляется один
 * раз на запуск. Вызов на каждое нажатие клавиши здесь ничего не стоит.
 */
export function allSuggestions(): string[] {
  return SKILL_SUGGESTIONS.flatMap((group) => group.titles.map((key) => t(key)));
}
