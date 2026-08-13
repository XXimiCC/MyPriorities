/**
 * Панель отладки: выделить кусок экрана, нарисовать поверх, описать словами,
 * отправить тикет.
 *
 * Как поставить в другой проект:
 *
 *   1. Скопировать этот каталог целиком.
 *   2. npm i modern-screenshot
 *   3. Один вызов в точке входа: mountDevkit({ endpoint, app, build }).
 *      Остальные поля адаптера необязательны и добавляются потом.
 *
 * Каталог не импортирует ничего из приложения — это проверяет tools/deps.test.ts.
 */

export { mountDevkit, revealDevkit } from './mount';
export { registerDevkitHost } from './host';
export type { DevkitHost, TicketPayload, LogEntry } from './types';
