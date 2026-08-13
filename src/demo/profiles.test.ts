/**
 * Проверка демо-профилей.
 *
 * Профили — не картинка, а данные, которые попадают в тот же стор, что и
 * настоящие: невалидный профиль сломает экран ровно так же, как повреждённая
 * копия. Поэтому здесь проверяются те же инварианты, которые чинит санитайзер, —
 * с той разницей, что генератор обязан их не нарушать, а не полагаться на починку.
 */

import { describe, expect, it } from 'vitest';

import { ACHIEVEMENTS } from '../achievements/registry';
import { exportSnapshot, parseSnapshot } from '../domain/snapshot';
import { blockMinutesOf, MAX_PRIORITIES, type BatteryShift } from '../domain/types';
import { MAX_ARCHIVED } from '../domain/settings';
import { LAST_MINUTE } from '../domain/battery';
import { MAX_ARCHIVED_SKILLS, MAX_SKILLS } from '../skills/types';
import { levelOf, RANK_ORDER, type RankId } from '../skills/levels';
import { DEMO_PROFILES, buildProfile, findProfile, type DemoId } from './profiles';

/**
 * Часы заморожены: истории считаются от «сегодня», и подвижная точка отсчёта
 * означала бы тест, который падает раз в неделю по субботам.
 *
 * Дата собирается по местному времени, а не из ISO: `dayKey` работает в часовом
 * поясе устройства, и UTC-полночь на машине восточнее Гринвича дала бы вчера.
 */
const NOW = new Date(2026, 7, 10, 12, 0, 0);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const built = new Map(DEMO_PROFILES.map((profile) => [profile.id, buildProfile(profile.id, NOW)]));

function contentsOf(id: DemoId) {
  return built.get(id)!;
}

function shiftsOf(id: DemoId): BatteryShift[] {
  return Object.values(contentsOf(id).journal.battery).flat();
}

function totalBlocks(id: DemoId): number {
  return Object.values(contentsOf(id).journal.clicks).reduce(
    (sum, day) => sum + Object.values(day).reduce((inner, blocks) => inner + blocks, 0),
    0,
  );
}

describe('демо-профили', () => {
  it('каждый профиль переживает круг через файл копии', () => {
    for (const profile of DEMO_PROFILES) {
      const contents = contentsOf(profile.id);
      // Санитайзер молча чинит всё, что может: расхождение здесь означает, что
      // генератор выдал то, что пришлось чинить.
      expect(parseSnapshot(exportSnapshot(contents, NOW)), profile.id).toEqual(contents);
    }
  });

  /*
   * Демо открывают на вкладке «Сегодня». Пустой сегодняшний день встречает
   * человека нулями и серыми жёлобами — то есть ровно тем, ради отсутствия
   * чего демо и существует. Раньше сегодня выпадал по тому же жребию, что и
   * любой другой день (`gapChance`), и у части профилей на части запусков был
   * пустым.
   */
  it('сегодняшний день заполнен у каждого профиля', () => {
    const today = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(
      NOW.getDate(),
    ).padStart(2, '0')}`;

    for (const profile of DEMO_PROFILES) {
      const day = contentsOf(profile.id).journal.clicks[today];
      expect(day, `${profile.id}: сегодня пуст`).toBeDefined();

      const blocks = Object.values(day ?? {}).reduce((sum, value) => sum + value, 0);
      expect(blocks, `${profile.id}: сегодня без блоков`).toBeGreaterThan(0);
    }
  });

  /*
   * И зеркальное условие: у сегодняшнего дня не должно быть будущего. Отметки
   * заряда позже «сейчас» делали последней отметкой дня вечернюю, а «текущий
   * заряд» — это именно последняя отметка (domain/stats.ts). Живое
   * переключение после этого не меняло на экране ничего.
   */
  it('у сегодняшнего дня нет отметок заряда из будущего', () => {
    const today = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(
      NOW.getDate(),
    ).padStart(2, '0')}`;
    const nowMinute = NOW.getHours() * 60 + NOW.getMinutes();

    for (const profile of DEMO_PROFILES) {
      for (const shift of contentsOf(profile.id).journal.battery[today] ?? []) {
        expect(shift[0], `${profile.id}: отметка в ${shift[0]} минуте при «сейчас» ${nowMinute}`)
          .toBeLessThanOrEqual(nowMinute);
      }
    }
  });

  it('идентификаторы уникальны и укладываются в пределы', () => {
    for (const profile of DEMO_PROFILES) {
      const { settings, skills } = contentsOf(profile.id);

      expect(settings.priorities.length, profile.id).toBeGreaterThan(0);
      expect(settings.priorities.length, profile.id).toBeLessThanOrEqual(MAX_PRIORITIES);
      expect(settings.archived.length, profile.id).toBeLessThanOrEqual(MAX_ARCHIVED);
      expect(skills.skills.length, profile.id).toBeLessThanOrEqual(MAX_SKILLS);
      expect(skills.archived.length, profile.id).toBeLessThanOrEqual(MAX_ARCHIVED_SKILLS);

      const priorityIds = [...settings.priorities, ...settings.archived].map((item) => item.id);
      expect(new Set(priorityIds).size, `${profile.id}: приоритеты`).toBe(priorityIds.length);

      const skillIds = [...skills.skills, ...skills.archived].map((item) => item.id);
      expect(new Set(skillIds).size, `${profile.id}: навыки`).toBe(skillIds.length);
    }
  });

  it('привязка навыка ведёт на существующий приоритет и не повторяется', () => {
    for (const profile of DEMO_PROFILES) {
      const { settings, skills } = contentsOf(profile.id);
      const active = new Set(settings.priorities.map((item) => item.id));

      const links = skills.skills
        .map((skill) => skill.linkedPriorityId)
        .filter((id): id is string => id !== undefined);

      for (const id of links) expect(active.has(id), `${profile.id}: ${id}`).toBe(true);
      expect(new Set(links).size, profile.id).toBe(links.length);

      // У архивного навыка привязка бессмысленна: он ничего не считает.
      for (const skill of skills.archived) expect(skill.linkedPriorityId).toBeUndefined();
    }
  });

  it('переходы заряда отсортированы и лежат в границах суток', () => {
    for (const profile of DEMO_PROFILES) {
      for (const [day, shifts] of Object.entries(contentsOf(profile.id).journal.battery)) {
        expect(day).toMatch(DAY);
        let previous = -1;
        for (const [minute, level] of shifts) {
          expect(minute, `${profile.id} ${day}`).toBeGreaterThan(previous);
          expect(minute).toBeLessThanOrEqual(LAST_MINUTE);
          expect([1, 2, 3, 4]).toContain(level);
          previous = minute;
        }
      }
    }
  });

  it('ключи дней и достижений записаны днями', () => {
    for (const profile of DEMO_PROFILES) {
      const { journal, skillClicks, awards } = contentsOf(profile.id);
      for (const day of Object.keys(journal.clicks)) expect(day).toMatch(DAY);
      for (const day of Object.keys(skillClicks)) expect(day).toMatch(DAY);
      for (const day of Object.values(awards)) expect(day).toMatch(DAY);
    }
  });

  it('два прогона дают одно и то же', () => {
    for (const profile of DEMO_PROFILES) {
      expect(buildProfile(profile.id, NOW), profile.id).toEqual(contentsOf(profile.id));
    }
  });

  it('поиск профиля не путается в чужих строках', () => {
    expect(findProfile('max')?.id).toBe('max');
    expect(findProfile('нет такого')).toBeUndefined();
    expect(findProfile(undefined)).toBeUndefined();
    expect(findProfile(null)).toBeUndefined();
  });
});

describe('профиль «Максимум»', () => {
  const max = () => contentsOf('max');

  it('открыт весь реестр достижений', () => {
    // Тип `AchievementId` шире реестра — в него попадают и служебные ключи
    // `ach.*`, — поэтому полнота таблицы стережётся здесь, а не компилятором.
    const missing = ACHIEVEMENTS.filter((item) => max().awards[item.id] === undefined);
    expect(missing.map((item) => item.id)).toEqual([]);
  });

  it('часов хватает на самое дорогое достижение', () => {
    const hours = (totalBlocks('max') * blockMinutesOf(max().settings)) / 60;
    expect(hours).toBeGreaterThanOrEqual(2500);
  });

  it('история непрерывна и длиннее года', () => {
    const days = Object.keys(max().journal.clicks).length;
    expect(days).toBeGreaterThanOrEqual(365);
  });

  it('список приоритетов предельный, и архив не пуст', () => {
    expect(max().settings.priorities).toHaveLength(MAX_PRIORITIES);
    expect(max().settings.archived.length).toBeGreaterThan(0);
  });

  it('лестница навыков занята целиком', () => {
    const ranks = new Set<RankId>(
      max().skills.skills.map((skill) => levelOf(skill.baseMinutes).rank),
    );
    expect([...ranks].sort((a, b) => RANK_ORDER[a] - RANK_ORDER[b])).toEqual([
      'none',
      'novice',
      'skilled',
      'expert',
      'master',
    ]);
  });
});

describe('ответы о том, что посадило заряд', () => {
  /*
   * Прежний мок клал переходы двухэлементными, и раздел «Что сажает батарею»
   * в демо был пуст — документация про это прямо извинялась. Проверяем, что
   * дыра закрыта, и на профиле для съёмки тоже.
   */
  it('есть у «Максимума», «Артёма» и «Выгорания»', () => {
    for (const id of ['max', 'm', 'burnout'] as const) {
      const answered = shiftsOf(id).filter((shift) => shift[2] !== undefined);
      expect(answered.length, id).toBeGreaterThanOrEqual(5);
    }
  });

  it('ответ — это либо приоритет, либо знак, либо свой текст', () => {
    for (const profile of DEMO_PROFILES) {
      const known = new Set(contentsOf(profile.id).settings.priorities.map((item) => item.id));
      for (const shift of shiftsOf(profile.id)) {
        const answer = shift[2];
        if (answer === undefined) continue;
        const ok = answer === '?' || answer.startsWith('!') || known.has(answer);
        expect(ok, `${profile.id}: ${answer}`).toBe(true);
      }
    }
  });
});

describe('профиль «Первая неделя»', () => {
  it('история и вправду короткая', () => {
    const days = Object.keys(contentsOf('start').journal.clicks).length;
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('ничего не выдано руками — достижения открывает автоматика', () => {
    expect(contentsOf('start').awards).toEqual({});
  });
});
