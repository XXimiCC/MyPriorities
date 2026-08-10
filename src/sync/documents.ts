/**
 * Настройки и каталог навыков как документы сервера.
 *
 * Форма — доменная, та же, что в копии данных: читаемый JSON без однобуквенных
 * полей. Компактная запись существует ради лимита в 4096 байт у CloudStorage,
 * а здесь его нет, и тащить за собой экономию, которой больше не нужно, значит
 * тащить и её цену — нечитаемый файл и лишний слой преобразований.
 */

import { sanitizeSkills, type SkillsState } from '../skills/types';
import { sanitizeSettings } from '../domain/settings';
import type { Settings } from '../domain/types';
import type { Stamper } from './ops';
import type { SyncDoc } from './transport';

export function settingsDoc(settings: Settings, stamp: Stamper): SyncDoc {
  return { kind: 'settings', body: JSON.stringify(settings), hlc: stamp() };
}

export function skillsDoc(skills: SkillsState, stamp: Stamper): SyncDoc {
  return { kind: 'skills', body: JSON.stringify(skills), hlc: stamp() };
}

export function docsFrom(settings: Settings, skills: SkillsState, stamp: Stamper): SyncDoc[] {
  return [settingsDoc(settings, stamp), skillsDoc(skills, stamp)];
}

export interface ReadDocs {
  settings?: Settings;
  skills?: SkillsState;
}

/**
 * Разбор пришедшего. Битый документ пропускается, а не заменяется пустышкой:
 * пустые настройки отправили бы человека в онбординг, а пустой каталог показал
 * бы, что навыков нет. Лучше остаться с тем, что уже есть на устройстве.
 */
export function readDocs(docs: SyncDoc[]): ReadDocs {
  const out: ReadDocs = {};
  for (const doc of docs) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(doc.body);
    } catch {
      console.warn(`[sync] документ ${doc.kind} не читается`);
      continue;
    }

    if (doc.kind === 'settings') {
      const settings = sanitizeSettings(parsed);
      // Настройки без приоритетов — не настройки: с ними экран пустой.
      if (settings && settings.priorities.length > 0) out.settings = settings;
    } else if (doc.kind === 'skills') {
      out.skills = sanitizeSkills(parsed);
    }
  }
  return out;
}
