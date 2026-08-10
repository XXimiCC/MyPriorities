export interface Env {
  DB: D1Database;

  /**
   * Версия развёртывания от Cloudflare. Локально привязки нет, и это нормально:
   * там «что развёрнуто» не вопрос.
   */
  CF_VERSION?: { id: string; tag?: string; timestamp?: string };

  /** Список origin через запятую. Пустой — браузерных клиентов не пускаем вовсе. */
  ALLOWED_ORIGINS: string;

  /** Токен бота. Только секрет Worker, в репозитории его нет и быть не должно. */
  TELEGRAM_BOT_TOKEN: string;
  /** Ключ подписи наших токенов. Тоже секрет. */
  JWT_SECRET: string;

  /**
   * Клиент входа через Telegram вне мини-аппа. Идентификатор совпадает с
   * номером бота и не тайна; секрет — отдельная от токена бота пара, и он тайна.
   */
  TELEGRAM_CLIENT_ID?: string;
  TELEGRAM_OAUTH_CLIENT_SECRET?: string;
  /** Кому слать ночной отчёт. Не задан — отчёт молча пропускается. */
  REPORT_CHAT_ID?: string;
}
