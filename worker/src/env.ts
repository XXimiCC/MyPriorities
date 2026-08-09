export interface Env {
  DB: D1Database;

  /** Список origin через запятую. Пустой — браузерных клиентов не пускаем вовсе. */
  ALLOWED_ORIGINS: string;

  /** Токен бота. Только секрет Worker, в репозитории его нет и быть не должно. */
  TELEGRAM_BOT_TOKEN: string;
  /** Ключ подписи наших токенов. Тоже секрет. */
  JWT_SECRET: string;
  /** Кому слать ночной отчёт. Не задан — отчёт молча пропускается. */
  REPORT_CHAT_ID?: string;
}
