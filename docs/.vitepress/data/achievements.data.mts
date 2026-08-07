/*
 * Справочник достижений собирается из настоящего реестра приложения.
 *
 * Семьдесят пять записей, переписанные в markdown руками, разошлись бы с кодом
 * на первом же добавленном достижении — и разошлись бы молча. Здесь источник
 * один: src/achievements/registry.ts.
 *
 * Импорт безопасен в Node: ни registry.ts, ни его зависимости не трогают window
 * на загрузке, а i18n выбирает локаль через `typeof window === 'undefined'`.
 */

import { ACHIEVEMENTS } from '../../../src/achievements/registry';
import { GROUPS } from '../../../src/achievements/types';
import { noteOf, titleOf } from '../../../src/achievements/note';
import { ruStrings } from '../../../src/i18n/ru';

const KIND_LABEL: Record<string, string> = {
  auto: 'сама',
  deed: 'за действие',
  manual: 'вручную',
};

export default {
  load() {
    const groups = GROUPS.map((group) => ({
      id: group,
      title: ruStrings[`ach.g.${group}` as keyof typeof ruStrings],
      items: ACHIEVEMENTS.filter((item) => item.group === group).map((item) => ({
        id: item.id,
        title: titleOf(item),
        note: noteOf(item),
        kind: item.kind,
        kindLabel: KIND_LABEL[item.kind] ?? item.kind,
        needsSkills: item.needs === 'skills',
      })),
    }));

    // Заголовки групп на странице стоят статически, ради якорей и оглавления,
    // а строки берутся отсюда по идентификатору группы. Что состав групп не
    // разъехался со страницей, сторожит src/docs.test.ts.
    const byGroup = Object.fromEntries(groups.map((group) => [group.id, group.items]));

    return {
      total: ACHIEVEMENTS.length,
      groups,
      byGroup,
      counts: {
        auto: ACHIEVEMENTS.filter((a) => a.kind === 'auto').length,
        deed: ACHIEVEMENTS.filter((a) => a.kind === 'deed').length,
        manual: ACHIEVEMENTS.filter((a) => a.kind === 'manual').length,
        needsSkills: ACHIEVEMENTS.filter((a) => a.needs === 'skills').length,
      },
    };
  },
};
