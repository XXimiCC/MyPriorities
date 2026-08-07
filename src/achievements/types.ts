import type { Journal, Settings } from '../domain/types';
import type { SkillTotal } from '../skills/total';
import type { Params, StringKey } from '../i18n';
import type { Derived } from './derive';

/**
 * Три вида достижений, потому что не всё выводится из данных.
 *
 * auto   — считается предикатом по истории и выдаётся само;
 * deed   — выдаётся действием в приложении. Нужен потому, что «сделал обои»
 *          или «скачал копию» в журнале не остаются: событие произошло и
 *          исчезло, а отметить его надо;
 * manual — ставится руками. Это и есть «отметить, что сделал в жизни»:
 *          проверить такое приложение не может и не должно.
 */
export type AchievementKind = 'auto' | 'deed' | 'manual';

export type GroupId =
  | 'start'
  | 'hours'
  | 'streak'
  | 'discipline'
  | 'balance'
  | 'charge'
  | 'skills'
  | 'ritual'
  | 'life';

export const GROUPS: readonly GroupId[] = [
  'start',
  'hours',
  'streak',
  'discipline',
  'balance',
  'charge',
  'skills',
  'ritual',
  'life',
];

export interface AchievementContext {
  settings: Settings;
  journal: Journal;
  /** Пустой массив, если модуль навыков выключен. */
  skills: SkillTotal[];
  derived: Derived;
  /** Приходит снаружи, а не берётся из Date.now(): иначе условия непроверяемы. */
  now: Date;
}

/**
 * Идентификатор достижения выводится из ключей строк, а не объявляется отдельно.
 *
 * Благодаря этому опечатка в id и забытое название — ошибки компиляции, а не
 * пустая карточка на экране: ключ `ach.<id>` обязан существовать в ru.ts.
 * Служебные пространства `ach.n.*` (условия) и `ach.g.*` (группы) исключены.
 */
type IdOf<K> = K extends `ach.${infer Id}` ? Id : never;
export type AchievementId = Exclude<IdOf<StringKey>, `n.${string}` | `g.${string}`>;

export interface Achievement {
  /**
   * Два символа. Идентификатор попадает в хранилище и НИКОГДА не меняется и
   * не переиспользуется: переименование превратило бы чужой трофей в другой,
   * а повторное использование выдало бы его задним числом.
   */
  id: AchievementId;
  group: GroupId;
  kind: AchievementKind;
  titleKey: StringKey;
  /** Условие. Шаблон общий для группы похожих, число приходит подстановкой. */
  noteKey: StringKey;
  noteParams?: Params;
  /** Только у kind: 'auto'. */
  test?(ctx: AchievementContext): boolean;
  /** Считается и показывается только при включённом модуле навыков. */
  needs?: 'skills';
}

/**
 * Идентификаторы, которые когда-либо использовались и больше не должны
 * достаться никому. Пока пусто — список ведётся с первого удаления.
 */
export const RETIRED_IDS: readonly string[] = [];
