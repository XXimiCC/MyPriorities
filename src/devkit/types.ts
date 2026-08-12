/**
 * Договор панели отладки с приложением, в котором она живёт.
 *
 * Этот файл — единственное место, где описано, что панель знает о хозяине.
 * Всё остальное в каталоге `devkit/` вычисляется из браузерных глобалей, и
 * это правило сторожит машина: `tools/deps.test.ts` не пускает отсюда ни
 * одного импорта наружу.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Чем нарисован штрих. Три инструмента — это осознанный предел, см. AnnotateLayer. */
export type Tool = 'pen' | 'rect' | 'arrow';

export interface Stroke {
  tool: Tool;
  color: string;
  /** Перо — все точки пути; рамка и стрелка — ровно две: начало и конец. */
  points: Point[];
}

export interface LogEntry {
  /** Смещение от `createdAt` в миллисекундах. Абсолютное время здесь лишнее. */
  at: number;
  kind: 'error' | 'warn' | 'onerror' | 'rejection' | 'action';
  text: string;
  /** Только у onerror и rejection. Обрезан. */
  stack?: string;
}

/** Почему кадра нет. Пустой тикет всё равно уходит — это важнее кадра. */
export type ShotError = 'import-failed' | 'timeout' | 'raster-failed' | 'encode-failed' | 'too-large';

export interface ShotInfo {
  mime: string;
  w: number;
  h: number;
  bytes: number;
  /** В каких координатах стоп-кадра вырезали. */
  crop: Rect;
  /** Сколько штрихов нарисовано: пустой кадр и размеченный читаются по-разному. */
  strokes: number;
}

export interface TicketPayload {
  /** Версия формата. Первое, что читают и сервер, и CLI. */
  v: 1;
  /** Придуман на клиенте: повторная отправка не заводит второй тикет. */
  id: string;
  app: string;
  /** Единственное поле, написанное рукой. */
  note: string;

  build: { id: string; time: string };
  /** Локальное время со смещением: «когда у человека», а не «когда у сервера». */
  createdAt: string;
  tzOffset: number;

  /** Свободная форма от хоста: 'home', 'edit', 'stats/week'. */
  route: string;

  env: {
    viewport: Size;
    /** Настоящий, до нашего ограничения при съёмке. */
    dpr: number;
    screen: Size;
    ua: string;
    language: string;
    online: boolean;
    client: Record<string, string | number | boolean>;
    flags: Record<string, boolean>;
  };

  /** Числа и перечисления от хоста. Прошло через redact(). */
  snapshot?: Record<string, unknown>;

  /** Последние записи журнала до момента жалобы. */
  log: LogEntry[];

  /** Куда ткнули перед жалобой. */
  target?: { path: string; html: string };

  shot?: ShotInfo;
  shotError?: ShotError;
  /** Хост не ответил на вызов — обычно потому, что приложение уже упало. */
  hostError?: string;
}

/**
 * Всё, что панель может узнать о приложении.
 *
 * Обязательны три поля. Остальное необязательно намеренно: панель обязана
 * работать и в проекте, у которого нет ни Telegram, ни стора, ни отметки
 * сборки. Каждый необязательный вызов обёрнут в try/catch — самый ценный тикет
 * приходит ровно тогда, когда приложение уже сломано, и падение хозяина не
 * должно уносить с собой единственный способ об этом рассказать.
 */
export interface DevkitHost {
  /** Куда слать. Пусто — панели нет вовсе, и это нормальная сборка. */
  endpoint: string;
  /** Имя продукта в тикете: один сервер обслуживает несколько проектов. */
  app: string;
  /** Отметка сборки: без неё «у меня не воспроизводится» неразрешимо. */
  build: { id: string; time: string };

  /** Где стоял человек. Свободная форма: 'home', 'edit', 'stats/week'. */
  route?(): string;
  /** Состояние в числах и перечислениях. НИКОГДА — в тексте пользователя. */
  snapshot?(): Record<string, unknown>;
  /** Диагностика окружения: платформа и версия клиента-обёртки. */
  client?(): Record<string, string | number | boolean>;
  /** Что меняет прочтение кадра: демо, гость, сеть, установленное приложение. */
  flags?(): Record<string, boolean>;

  /** Токен доступа. Берётся в момент отправки и нигде не сохраняется. */
  authToken?(): Promise<string | undefined>;

  /**
   * Ключ приглашённого тестировщика, если приложение открыли по такой ссылке
   * НЕ через адресную строку. Обычный `?test=` панель читает сама; это — для
   * обёрток вроде мини-аппа Telegram, где параметр приезжает своим путём.
   */
  invite?(): string | undefined;

  /**
   * Приложение само решило, что значок нужно показать сразу.
   *
   * Нужно там, где ни адресной строки, ни жеста нет: в клиенте Telegram на
   * компьютере адрес не поправить, сенсорного экрана нет, а сочетание клавиш
   * может забрать себе сам клиент. Ссылку же он открывает всегда.
   */
  visible?(): boolean;

  /** Тактильная отдача. Не задано — тихо. */
  haptics?: { tap(): void; success(): void; warning(): void };
  /** Системная «назад». Возвращает функцию снятия — как в telegram/sdk.ts. */
  backButton?: { show(handler: () => void): () => void };

  /** Что снимать. По умолчанию `#root`, иначе `body`. */
  captureRoot?(): HTMLElement | null;
  /** Черновики держать только в памяти: демо не оставляет следов на устройстве. */
  ephemeral?: boolean;
}
