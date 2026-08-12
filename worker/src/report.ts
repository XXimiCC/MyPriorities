/**
 * Ночной отчёт о состоянии базы.
 *
 * Появляется раньше самих данных намеренно. Бесплатный тариф D1 — это 5 ГБ и
 * суточные лимиты на строки, и упереться в них молча означало бы узнать о
 * проблеме от пользователей. Одна строчка в Telegram раз в сутки стоит дёшево,
 * а предупреждение приходит за месяцы до потолка.
 *
 * Отчёт идёт тому же боту, что обслуживает мини-апп: заводить ради этого
 * отдельный канал незачем.
 */

import { compactAll } from './compact';
import { countOpenTickets, purgeOldTickets } from './devkit';
import type { Env } from './env';
import { sendMessage } from './telegram';

/** Потолок бесплатного тарифа D1. */
const QUOTA_BYTES = 5 * 1024 * 1024 * 1024;
/** Доля, после которой отчёт перестаёт быть справкой и становится предупреждением. */
const WARN_AT = 0.6;

export interface Usage {
  users: number;
  devices: number;
  ops: number;
  snapshots: number;
  /** Оценка по числу строк: точного размера D1 изнутри не отдаёт. */
  estimatedBytes: number;
  /** Сколько тикетов из панели отладки ждёт разбора. */
  openTickets: number;
}

/** Средний вес строки журнала с индексами. Проверяется по факту, а не гадается вечно. */
const BYTES_PER_OP = 250;
const BYTES_PER_SNAPSHOT = 1200;

export async function collectUsage(env: Env): Promise<Usage> {
  const one = async (sql: string): Promise<number> => {
    const row = await env.DB.prepare(sql).first<{ n: number }>();
    return Number(row?.n ?? 0);
  };

  const [users, devices, ops, snapshots, openTickets] = await Promise.all([
    one('select count(*) as n from profiles'),
    one('select count(*) as n from devices'),
    one('select count(*) as n from ops'),
    one('select count(*) as n from month_snapshots'),
    countOpenTickets(env),
  ]);

  return {
    users,
    devices,
    ops,
    snapshots,
    estimatedBytes: ops * BYTES_PER_OP + snapshots * BYTES_PER_SNAPSHOT,
    openTickets,
  };
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function formatReport(usage: Usage): string {
  const share = usage.estimatedBytes / QUOTA_BYTES;
  const perUser = usage.users > 0 ? Math.round(usage.estimatedBytes / usage.users) : 0;

  const lines = [
    share >= WARN_AT ? '<b>⚠️ База подходит к потолку</b>' : '<b>MyPriorities — ночной отчёт</b>',
    '',
    `Людей: ${usage.users}, устройств: ${usage.devices}`,
    `Операций: ${usage.ops}, свёрток: ${usage.snapshots}`,
    `Занято примерно ${mb(usage.estimatedBytes)} из 5 ГБ (${(share * 100).toFixed(1)} %)`,
  ];
  if (usage.users > 0) lines.push(`На человека — около ${(perUser / 1024).toFixed(0)} КБ`);
  // Строка появляется только когда есть о чём говорить: «тикетов 0» каждую ночь
  // приучает не читать отчёт целиком.
  if (usage.openTickets > 0) lines.push(`Тикетов открыто: ${usage.openTickets}`);
  if (share >= WARN_AT) {
    lines.push('', 'Пора включать свёртку журнала или расширять тариф.');
  }
  return lines.join('\n');
}

export async function runNightlyMaintenance(env: Env): Promise<void> {
  /*
   * Свёртка идёт до отчёта, чтобы он показывал состояние после уборки, а не
   * до неё. Иначе цифры пугали бы ровно в тот момент, когда проблема уже решена.
   */
  try {
    const result = await compactAll(env);
    if (result.folded > 0) {
      console.info(`[compact] свёрнуто операций: ${result.folded} у ${result.users} чел.`);
    }
  } catch (error) {
    console.warn('[compact] свёртка не удалась', error);
  }

  /* Кадры гасит сам KV по сроку хранения, здесь остаются строки. Уборка стоит
     рядом со свёрткой намеренно: и то и другое — про то, чтобы база не росла
     вечно, и разносить их по разным местам значит однажды забыть про одно. */
  try {
    const gone = await purgeOldTickets(env);
    if (gone > 0) console.info(`[devkit] убрано старых тикетов: ${gone}`);
  } catch (error) {
    console.warn('[devkit] уборка тикетов не удалась', error);
  }

  await runNightlyReport(env);
}

export async function runNightlyReport(env: Env): Promise<void> {
  // Не задан адресат — отчёт просто не шлётся. Это не ошибка: на локальной
  // машине и в предпродакшене слать его некуда и незачем.
  if (!env.REPORT_CHAT_ID) return;
  try {
    const usage = await collectUsage(env);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, env.REPORT_CHAT_ID, formatReport(usage));
  } catch (error) {
    console.warn('[report] отчёт не собрался', error);
  }
}
