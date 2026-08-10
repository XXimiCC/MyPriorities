/**
 * Разовый перенос из прежнего хранилища в журнал.
 *
 * До этого файла у приложения было два источника истины: прежнее хранилище с
 * месячными блоками и журнал операций. Устройство читало первое, писало в оба и
 * переставало писать в первое только после удачного обмена с сервером. Ровно на
 * этой развилке и потерялись данные: «переехал ли я» зависело от того, ответил
 * ли сервер, — то есть от сети.
 *
 * Теперь развилки нет. Перенос делается один раз, целиком на устройстве, без
 * сети и без сессии: прежнее хранилище читается, превращается в операции и
 * больше не трогается никогда. Сервер к этому моменту отношения не имеет — он
 * догоняет потом, обычным обменом.
 *
 * Прежнее хранилище при этом не стирается. Оно остаётся как есть до тех пор,
 * пока не переедут все устройства: перенос, который нечем перепроверить, —
 * это перенос без права на ошибку.
 */

import { sanitizeAwards } from '../achievements/types';
import type { SnapshotContents } from '../domain/snapshot';
import type { ClicksMap } from '../domain/types';
import { emptyJournal } from '../domain/types';
import { emptySettings } from '../domain/settings';
import {
  allStoredMonths,
  loadAwards,
  loadJournal,
  loadSettings,
  loadSkillClicks,
  loadSkills,
} from '../store/legacy/persistence';
import { opsLog } from '../store/local/db';
import { backupOnce } from './adopt';
import { settingsDoc, skillsDoc } from './documents';
import { opsToFill } from './fill';
import { isMigrated, markMigrated, writeLocalDocs } from './local';
import type { Op, Stamper } from './ops';
import { emptyBase, project } from './project';

/** Читает прежнее хранилище целиком. Бросает, если оно недоступно. */
async function readLegacy(): Promise<SnapshotContents> {
  const months = await allStoredMonths();
  return {
    settings: (await loadSettings()) ?? emptySettings(),
    skills: await loadSkills(),
    awards: await loadAwards(),
    journal: await loadJournal(months),
    skillClicks: await loadSkillClicks(months),
  };
}

function counted(clicks: ClicksMap): number {
  return Object.values(clicks).reduce(
    (sum, day) => sum + Object.values(day).reduce((inner, n) => inner + n, 0),
    0,
  );
}

function anything(contents: SnapshotContents): boolean {
  return (
    contents.settings.priorities.length > 0 ||
    Object.keys(contents.journal.clicks).length > 0 ||
    Object.keys(contents.journal.battery).length > 0 ||
    Object.keys(contents.skillClicks).length > 0 ||
    contents.skills.skills.length > 0
  );
}

/**
 * Сошёлся ли перенос.
 *
 * Проверка нужна именно здесь, потому что дальше пути назад нет: отметка о
 * переносе гасит чтение прежнего хранилища навсегда. Сравнивается не «похоже
 * ли», а каждая ячейка: день, id, число. Расхождение означает ошибку в правилах
 * — и тогда лучше не переносить вовсе, оставив устройство на прежнем чтении.
 */
function sameHistory(want: SnapshotContents, got: ReturnType<typeof project>): boolean {
  const sameClicks = (a: ClicksMap, b: ClicksMap): boolean => {
    const days = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const day of days) {
      const left = a[day] ?? {};
      const right = b[day] ?? {};
      const ids = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const id of ids) {
        if ((left[id] ?? 0) !== (right[id] ?? 0)) return false;
      }
    }
    return true;
  };

  if (!sameClicks(want.journal.clicks, got.journal.clicks)) return false;
  if (!sameClicks(want.skillClicks, got.skillClicks)) return false;

  const days = new Set([
    ...Object.keys(want.journal.battery),
    ...Object.keys(got.journal.battery),
  ]);
  for (const day of days) {
    const left = [...(want.journal.battery[day] ?? [])].sort((x, y) => x[0] - y[0]);
    const right = [...(got.journal.battery[day] ?? [])].sort((x, y) => x[0] - y[0]);
    if (JSON.stringify(left) !== JSON.stringify(right)) return false;
  }

  const awards = sanitizeAwards({ g: want.awards });
  const ids = new Set([...Object.keys(awards), ...Object.keys(got.awards)]);
  for (const id of ids) {
    if (awards[id] !== got.awards[id]) return false;
  }
  return true;
}

export interface Imported {
  /** Состояние после переноса — им и открывается приложение. */
  contents: SnapshotContents;
  /** Сколько операций записано. Ноль у нового устройства. */
  ops: number;
}

/**
 * Переносит прежнее хранилище в журнал, если это ещё не сделано.
 *
 * undefined — перенести не удалось: хранилище не ответило или перенос не сошёлся
 * с исходником. В обоих случаях не изменилось ничего, и следующий запуск
 * попробует снова.
 */
export async function importLegacyOnce(stamp: Stamper): Promise<Imported | undefined> {
  if (await isMigrated()) return undefined;

  let legacy: SnapshotContents;
  try {
    legacy = await readLegacy();
  } catch (error) {
    // Пустая память здесь означает «не отдали», а не «ничего нет». Перенести
    // такое значило бы записать пустоту вместо истории.
    console.warn('[import] прежнее хранилище не прочиталось, перенос отложен', error);
    return undefined;
  }

  if (!anything(legacy)) {
    // Новому устройству переносить нечего. Отметка всё равно ставится: иначе
    // прежнее хранилище перечитывалось бы при каждом запуске впустую.
    await markMigrated();
    return { contents: legacy, ops: 0 };
  }

  /*
   * Операции без барьера `clear`.
   *
   * Барьер сказал бы «всё, что было до меня, не в счёт», и уехав однажды на
   * сервер, отменил бы историю других устройств. Здесь же нечего отменять:
   * журнал пуст, и итоги по ячейкам описывают его целиком.
   */
  const ops: Op[] = opsToFill(
    legacy,
    { journal: emptyJournal(), skillClicks: {}, awards: {} },
    stamp,
  );

  const check = project(emptyBase(), ops);
  if (!sameHistory(legacy, check)) {
    console.warn('[import] перенос не сошёлся с исходником, оставляем как было');
    return undefined;
  }

  await backupOnce(legacy);

  /*
   * Операции кладутся уже доставленными.
   *
   * Отправлять их на сервер напрямую нельзя: это абсолютные установки по каждой
   * ячейке, и на сервере, где уже есть история другого устройства, они бы её
   * перебили. Своё туда попадёт иначе — доливкой, которая сравнивает и отдаёт
   * только недостающее.
   */
  await opsLog.append(ops, 1);
  await writeLocalDocs([settingsDoc(legacy.settings, stamp), skillsDoc(legacy.skills, stamp)]);
  await markMigrated();

  console.info(`[import] перенесено операций: ${ops.length}, блоков: ${counted(legacy.journal.clicks)}`);
  return { contents: legacy, ops: ops.length };
}
