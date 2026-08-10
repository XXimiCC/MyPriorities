/**
 * Детерминированный источник случайности для демо-профилей.
 *
 * Не `Math.random()`: одна и та же картинка нужна и глазу, и скриншотам
 * документации, и тесту, который сверяет два прогона генератора между собой.
 * Линейный конгруэнтный — тот же, что раньше жил в `store/mock.ts`.
 */

export interface Random {
  /** Дробное в [0, 1). */
  next(): number;
  chance(probability: number): boolean;
  /** Целое из отрезка, оба конца включительно. */
  between(min: number, max: number): number;
  pick<T>(list: readonly T[]): T;
}

export function makeRandom(seed: number): Random {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };

  return {
    next,
    chance: (probability) => next() < probability,
    between: (min, max) => (max <= min ? min : min + Math.floor(next() * (max - min + 1))),
    // Пустой список сюда попасть не может: все наборы в профилях заданы литералами.
    pick: (list) => list[Math.floor(next() * list.length)]!,
  };
}
