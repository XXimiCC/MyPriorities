/**
 * Иконки нарисованы той же батареей, что и сама иконка в шапке.
 *
 * Генератор (tools/shots/brand.mjs) держит копию геометрии: импортировать
 * .ts из node без сборки нельзя, а тянуть загрузчик TypeScript ради двадцати
 * чисел незачем. Копия без сторожа тихо разъезжается с оригиналом — и разъезд
 * обнаруживается не здесь, а на чьём-то домашнем экране через полгода, где
 * иконка внезапно не та, что в приложении.
 *
 * Тест лежит в tools/ по той же причине, что и docs.test.ts: ему нужны типы
 * Node, а продуктовому коду их видеть незачем.
 */

import { describe, expect, it } from 'vitest';

import { BATTERY_GEOMETRY, BOLT_PATH } from '../src/components/batteryGeometry';
// @ts-expect-error — .mjs без типов; ради двадцати чисел объявление писать незачем
import { GEOMETRY, BOLT_PATH as BOLT_COPY } from './shots/brand.mjs';

describe('генератор иконок', () => {
  it('повторяет геометрию батареи приложения', () => {
    expect(GEOMETRY).toEqual(BATTERY_GEOMETRY);
  });

  it('повторяет молнию зарядки', () => {
    expect(BOLT_COPY).toBe(BOLT_PATH);
  });
});
