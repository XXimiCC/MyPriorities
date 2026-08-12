/*
 * Сторож палитры.
 *
 * Цвета приложения живут в двух видах: CSS-токенами в `src/styles/tokens.css` и
 * объектами в `src/domain/palette.ts`. Свести их в один источник нельзя — холст
 * обоев и генератор иконок читают палитру из ноды, где никакого документа нет,
 * а CSS-переменную оттуда не вычислить.
 *
 * Значит, дубль остаётся; охраняется он этим тестом. Расхождение здесь тихое и
 * оттого дорогое: полоса приоритета красится из TS, а её жёлоб — из CSS, и
 * сдвиг цвета на один тон никто не замечает, пока они не окажутся рядом.
 *
 * Тест живёт в tools/, а не в src/: чтение файла требует типов ноды, и пускать
 * их в продуктовый код ради одной проверки нельзя (см. tools/tsconfig.json).
 *
 * Чего этот тест НЕ проверяет: что все цвета приложения вообще взяты из
 * палитры. Такой поиск по `#hex` в src/** ловил бы и золото плашки достижения,
 * и чёрный текст на неоновой заливке — то есть намеренные исключения, каждое из
 * которых объяснено на месте. Проверка, которую приходится всё время
 * заглушать, перестаёт что-либо значить.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BATTERY_THEMES, NEON_PALETTE } from '../src/domain/palette';

const TOKENS = readFileSync(
  fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url)),
  'utf8',
).toLowerCase();

describe('палитра', () => {
  it.each(NEON_PALETTE.map((color, index) => [index, color.hex, color.name] as const))(
    '--p%i (%s, %s) объявлен в токенах',
    (index, hex) => {
      expect(TOKENS, `цвет приоритета ${hex} из palette.ts обязан быть в tokens.css`).toContain(
        `--p${index}: ${hex.toLowerCase()};`,
      );
    },
  );

  it.each(Object.values(BATTERY_THEMES).map((theme) => [theme.label, theme.hex, theme.soft] as const))(
    'уровень %s (%s) объявлен в токенах',
    (label, hex, soft) => {
      expect(TOKENS, `цвет заряда ${label} = ${hex} обязан быть в tokens.css`).toContain(
        hex.toLowerCase(),
      );
      expect(TOKENS, `светлый край ${label} = ${soft} обязан быть в tokens.css`).toContain(
        soft.toLowerCase(),
      );
    },
  );

  it('светлые края палитры не разъехались с основными тонами', () => {
    // Пары hex/soft берутся из одного и того же места и в CSS, и в TS: у
    // токенов светлый край объявлен только для уровней заряда, поэтому здесь
    // проверяется само существование пары, а не её адрес.
    const broken = NEON_PALETTE.filter((color) => color.hex === color.soft);
    expect(broken, 'светлый край обязан отличаться от основного тона').toEqual([]);
  });
});
