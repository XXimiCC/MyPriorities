import type { DayKey } from '../domain/types';

/**
 * Навык — это то, во что вкладывают часы годами, в отличие от приоритета,
 * который описывает одну неделю жизни.
 *
 * Часы навыка складываются из трёх источников, и каждый нужен по своей причине:
 *   baseMinutes  — накопленное до приложения; без него гитарист с десятилетним
 *                  стажем начинал бы с «обучение не начато», и лестница до
 *                  пяти тысяч часов не имела бы смысла;
 *   carryBlocks  — блоки из месяцев, выпавших за горизонт хранения; без них
 *                  число часов начало бы уменьшаться через год после первой записи;
 *   блоки        — то, что лежит в загруженной истории: свои и, если есть
 *                  привязка, блоки приоритета.
 *
 * Слагаемые складываются, а не заменяют друг друга: навык мог копить сам и
 * только потом получить привязку, и его собственные часы не должны при этом
 * пропасть. Побочный эффект — привязка ничего не записывает и полностью обратима.
 */
export interface Skill {
  /** Два символа: id повторяется в каждом дне истории. */
  id: string;
  title: string;
  /** Индекс в NEON_PALETTE. */
  colorId: number;
  /** Часы до приложения, в минутах. Ценой блока НЕ переоценивается — это факт, а не клики. */
  baseMinutes: number;
  /** Блоки из свёрнутых месяцев. Переоцениваются вместе со всеми остальными. */
  carryBlocks: number;
  /** Приоритет, чьи клики засчитываются навыку. Один приоритет кормит не больше одного навыка. */
  linkedPriorityId?: string;
  /** Когда начали заниматься. Нужно только чтобы показать «в этом уже 12 лет». */
  startedOn?: DayKey;
}

export interface SkillsState {
  skills: Skill[];
  /** Удалённые навыки: их часы возвращаются, если завести навык с тем же названием. */
  archived: Skill[];
  /**
   * Последний месяц, уже свёрнутый в carryBlocks. Защита от двойного учёта:
   * второе устройство, увидев продвинутый маркер, свёртку пропускает.
   */
  foldedThrough?: string;
}

/**
 * Двенадцать — не вкусовое ограничение, а лимит хранилища: месяц с двенадцатью
 * навыками занимает около 3200 символов при пределе CloudStorage в 4096.
 */
export const MAX_SKILLS = 12;
export const MAX_ARCHIVED_SKILLS = 12;
export const MAX_SKILL_TITLE = 24;

export function emptySkills(): SkillsState {
  return { skills: [], archived: [] };
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function cleanSkill(raw: unknown, seen: Set<string>): Skill | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Partial<Skill>;
  if (typeof value.id !== 'string' || !value.id) return undefined;
  if (typeof value.title !== 'string') return undefined;
  if (seen.has(value.id)) return undefined;
  seen.add(value.id);

  const base = Number(value.baseMinutes);
  const carry = Number(value.carryBlocks);
  return {
    id: value.id,
    title: value.title.slice(0, MAX_SKILL_TITLE),
    colorId: Number(value.colorId) || 0,
    baseMinutes: Number.isFinite(base) && base > 0 ? Math.floor(base) : 0,
    carryBlocks: Number.isFinite(carry) && carry > 0 ? Math.floor(carry) : 0,
    ...(typeof value.linkedPriorityId === 'string' && value.linkedPriorityId
      ? { linkedPriorityId: value.linkedPriorityId }
      : {}),
    ...(typeof value.startedOn === 'string' && DAY_PATTERN.test(value.startedOn)
      ? { startedOn: value.startedOn }
      : {}),
  };
}

/**
 * Разбор каталога в его обычном виде — так навыки лежат в копии данных, которую
 * человек может открыть и прочитать. Компактная форма нужна только хранилищу,
 * и разворачивает её оно само, а сюда отдаёт уже развёрнутое.
 *
 * Инвариант «один приоритет кормит не больше одного навыка» чинится именно
 * здесь: две привязки к одному приоритету означали бы, что одни и те же часы
 * засчитаны дважды, и такое лучше поправить молча, чем показать.
 */
export function sanitizeSkills(raw: unknown): SkillsState {
  if (typeof raw !== 'object' || raw === null) return emptySkills();
  const value = raw as Partial<SkillsState>;

  // Список общий: один навык не может быть одновременно активным и архивным.
  const seen = new Set<string>();
  const clean = (list: unknown): Skill[] =>
    (Array.isArray(list) ? list : [])
      .map((item) => cleanSkill(item, seen))
      .filter((item): item is Skill => item !== undefined);

  const skills = clean(value.skills).slice(0, MAX_SKILLS);
  const linked = new Set<string>();
  for (const skill of skills) {
    if (!skill.linkedPriorityId) continue;
    if (linked.has(skill.linkedPriorityId)) delete skill.linkedPriorityId;
    else linked.add(skill.linkedPriorityId);
  }

  return {
    skills,
    // У архивных навыков привязка бессмысленна: они ничего не считают.
    archived: clean(value.archived)
      .slice(-MAX_ARCHIVED_SKILLS)
      .map(({ linkedPriorityId: _drop, ...rest }) => rest),
    ...(typeof value.foldedThrough === 'string' && MONTH_PATTERN.test(value.foldedThrough)
      ? { foldedThrough: value.foldedThrough }
      : {}),
  };
}
