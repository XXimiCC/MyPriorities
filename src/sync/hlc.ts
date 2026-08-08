/**
 * Гибридные логические часы.
 *
 * Каждой операции нужна метка, по которой два устройства одинаково решат, какая
 * из двух правок новее. Стенные часы для этого не годятся: всё в приложении
 * завязано на системное время устройства, и `pruneOldMonths` уже содержит явную
 * защиту от сбитых часов — «ни один месяц не попал в горизонт, значит доверять
 * этому „сегодня“ нельзя». Метка, взятая из `Date.now()` телефона с неверной
 * датой, навсегда выиграла бы у всех остальных или навсегда проиграла.
 *
 * Гибридные часы берут от физического времени только то, что оно обычно идёт
 * вперёд, а порядок держат счётчиком. Метка монотонна даже если часы перевели
 * назад, и подтягивается вверх, когда приходит операция от устройства, которое
 * ушло вперёд.
 *
 * Метка — строка фиксированной ширины, поэтому сравнивать её можно обычным
 * строковым сравнением, а сортировать — обычным `sort()`. Это же позволяет
 * хранить её как `text` и сравнивать прямо в SQL.
 */

/** Хватает до 33658 года — запас, который переживёт любые разумные часы. */
const WALL_DIGITS = 15;
const COUNTER_DIGITS = 5;
const MAX_COUNTER = 10 ** COUNTER_DIGITS - 1;

/**
 * Насколько чужие часы могут опережать наши, прежде чем мы перестанем за ними
 * тянуться. Устройство с датой в 2099 году иначе задрало бы метку всем, кто с
 * ним синхронизировался, и вернуть её назад было бы уже нечем.
 */
const MAX_DRIFT_MS = 24 * 60 * 60 * 1000;

export interface HlcState {
  wall: number;
  counter: number;
}

export interface Stamp extends HlcState {
  deviceId: string;
}

export function emptyHlc(): HlcState {
  return { wall: 0, counter: 0 };
}

function bumped(wall: number, counter: number): HlcState {
  return counter > MAX_COUNTER ? { wall: wall + 1, counter: 0 } : { wall, counter };
}

/** Следующая метка для собственной операции. */
export function tick(state: HlcState, physical: number): HlcState {
  const now = Math.floor(physical);
  // Часы, ушедшие назад, не откатывают метку: продолжаем счётчиком.
  if (now <= state.wall) return bumped(state.wall, state.counter + 1);
  return { wall: now, counter: 0 };
}

/**
 * Учитывает чужую метку. Вызывается на каждую пришедшую операцию: без этого
 * устройство с отстающими часами вечно проигрывало бы все сравнения.
 */
export function observe(state: HlcState, remote: string, physical: number): HlcState {
  const parsed = parseStamp(remote);
  if (!parsed) return tick(state, physical);

  const now = Math.floor(physical);
  const remoteWall = parsed.wall > now + MAX_DRIFT_MS ? 0 : parsed.wall;
  const wall = Math.max(state.wall, remoteWall, now);

  if (wall === state.wall && wall === remoteWall) {
    return bumped(wall, Math.max(state.counter, parsed.counter) + 1);
  }
  if (wall === state.wall) return bumped(wall, state.counter + 1);
  if (wall === remoteWall) return bumped(wall, parsed.counter + 1);
  return { wall, counter: 0 };
}

/**
 * Метка в строку. Ширина фиксирована ровно ради того, чтобы строковое сравнение
 * совпадало с числовым: `"9" > "10"`, а `"00009" < "00010"`.
 *
 * Идентификатор устройства в конце — не украшение, а разрешение ничьей: две
 * операции с одинаковыми стенными часами и счётчиком должны получить строгий
 * порядок, иначе устройства разойдутся в том, какая из них новее.
 */
export function formatStamp(state: HlcState, deviceId: string): string {
  const wall = String(Math.max(0, Math.floor(state.wall))).padStart(WALL_DIGITS, '0');
  const counter = String(Math.max(0, Math.floor(state.counter))).padStart(COUNTER_DIGITS, '0');
  return `${wall}:${counter}:${deviceId}`;
}

const STAMP_PATTERN = new RegExp(`^(\\d{${WALL_DIGITS}}):(\\d{${COUNTER_DIGITS}}):([a-z0-9]+)$`);

/** Разбор чужой метки. Всё, что не соответствует форме, — не метка. */
export function parseStamp(raw: unknown): Stamp | undefined {
  if (typeof raw !== 'string') return undefined;
  const match = STAMP_PATTERN.exec(raw);
  if (!match) return undefined;
  return { wall: Number(match[1]), counter: Number(match[2]), deviceId: match[3]! };
}

export interface Clock {
  /** Метка для новой операции. Каждый вызов строго больше предыдущего. */
  stamp(): string;
  /** Подтянуть часы под пришедшую метку. */
  observe(remote: string): void;
  /** Состояние для сохранения между запусками: без него счётчик обнулится. */
  state(): HlcState;
}

/**
 * Часы устройства.
 *
 * Состояние приходит снаружи и наружу же отдаётся: где его хранить, знает слой
 * хранилища, а не часы. Так их можно проверить, не поднимая базу.
 */
export function createClock(
  deviceId: string,
  initial: HlcState = emptyHlc(),
  now: () => number = Date.now,
): Clock {
  let state = initial;
  return {
    stamp() {
      state = tick(state, now());
      return formatStamp(state, deviceId);
    },
    observe(remote) {
      state = observe(state, remote, now());
    },
    state() {
      return state;
    },
  };
}
