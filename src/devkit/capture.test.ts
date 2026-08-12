import { describe, expect, it } from 'vitest';

import { ASSET_WAIT, CaptureFailed, RASTER_TIMEOUT } from './capture';

describe('сроки съёмки', () => {
  it('ожидание ресурсов заметно короче ожидания кадра', () => {
    /*
     * Сторож на конкретную ошибку, а не на абстрактный инвариант.
     *
     * Пока оба срока были равны, библиотека переставала ждать картинки ровно в
     * тот момент, когда истекал наш собственный срок, и до отрисовки дело не
     * доходило никогда. На странице лендинга с ленивыми картинками ниже сгиба
     * это означало, что кадр не снимался вообще — двадцать шесть секунд и отказ.
     */
    expect(ASSET_WAIT).toBeLessThan(RASTER_TIMEOUT / 2);
  });

  it('на отрисовку остаётся не меньше пяти секунд', () => {
    // Слабый телефон рисует сложную страницу секунды, а не миллисекунды.
    expect(RASTER_TIMEOUT - ASSET_WAIT).toBeGreaterThanOrEqual(5000);
  });
});

describe('отказ съёмки', () => {
  it('несёт причину, а не только текст', () => {
    // По этой причине CLI потом пишет в тикете, чего именно не хватило.
    const failure = new CaptureFailed('timeout');
    expect(failure.reason).toBe('timeout');
    expect(failure).toBeInstanceOf(Error);
  });
});
