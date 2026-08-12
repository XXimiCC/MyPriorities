/**
 * Ключ приглашённого тестировщика.
 *
 * Задача, которую он решает: человек согласился помочь, открыл приложение,
 * увидел баг — и должен суметь о нём рассказать, не узнавая свой номер Telegram
 * и не разучивая жест тремя пальцами. Ему выдаётся ссылка, и в ней всё, что
 * нужно: панель показывается кнопкой, а сервер принимает от него тикеты.
 *
 * Ключ читается из адреса и запоминается на время вкладки. Источников два:
 * обычная ссылка с `?test=` и вход в мини-апп, где параметр приезжает не в
 * адресе, а через клиент Telegram, — и приложение отдаёт его панели само (см.
 * DevkitHost.invite).
 *
 * Хранится в sessionStorage, а не в localStorage, и это выбор, а не мелочь:
 * документация — обычный многостраничный сайт, и при переходе по ссылке
 * параметр из адреса пропадает вместе со страницей. Сессия вкладки живёт ровно
 * столько, сколько её смотрят: закрыл — забыли. Постоянное хранилище означало
 * бы, что человек, которому один раз показали ссылку, остался тестировщиком
 * навсегда, а отозвать это было бы нечем.
 */

const PARAM = 'test';
const KEY = 'devkit:invite';

let remembered: string | undefined;

/** Ключ из адресной строки. Пусто — значит его там нет. */
export function inviteFromSearch(search: string): string | undefined {
  const value = new URLSearchParams(search).get(PARAM)?.trim();
  return value ? value : undefined;
}

export function rememberInvite(value: string | undefined): void {
  remembered = value;
  try {
    if (value) sessionStorage.setItem(KEY, value);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* приватный режим или запрет хранилища: ключ доживёт до конца страницы */
  }
}

export function inviteKey(): string | undefined {
  if (remembered) return remembered;
  try {
    return sessionStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Ключ этой страницы: свежий из адреса либо запомненный раньше.
 *
 * Отсутствие ключа в адресе НЕ стирает запомненный — иначе первый же переход
 * по внутренней ссылке документации выкидывал бы тестировщика на улицу.
 */
export function resolveInvite(search: string, fromHost?: string): string | undefined {
  const fresh = inviteFromSearch(search) ?? fromHost;
  if (fresh) rememberInvite(fresh);
  return inviteKey();
}
