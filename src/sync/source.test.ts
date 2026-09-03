/**
 * Разбор метки источника.
 *
 * Метка — это ответ на вопрос «пришёл ли хоть кто-нибудь по этой ссылке», и
 * ответ разовый: профиль заводится один раз, второй попытки записать источник
 * не будет. Поэтому здесь проверяется не только то, что метка находится, но и
 * то, что она не находится там, где её нет: ложная метка портит ответ так же,
 * как потерянная.
 */

import { describe, expect, it } from 'vitest';

import { readSource } from './source';

describe('метка источника', () => {
  it('приезжает хвостом ссылки в Telegram', () => {
    expect(readSource('', 'from_habr')).toBe('habr');
    expect(readSource('', 'from_product-hunt')).toBe('product-hunt');
  });

  it('приезжает адресной строкой в браузере', () => {
    expect(readSource('?from=habr', undefined)).toBe('habr');
    expect(readSource('?lang=en&from=site-en', undefined)).toBe('site-en');
  });

  it('без метки её и нет', () => {
    expect(readSource('', undefined)).toBeUndefined();
    expect(readSource('?lang=en', undefined)).toBeUndefined();
    expect(readSource('?from=', undefined)).toBeUndefined();
  });

  it('демо-приглашение меткой не считается', () => {
    // `startapp` один на всех, и `demo_` занят раньше. Без префикса метка
    // притащила бы в базу источник «max» на каждого, кто открыл чужую жизнь.
    expect(readSource('', 'demo_max')).toBeUndefined();
    expect(readSource('', 'demo_burnout')).toBeUndefined();
  });

  it('чужой хвост ссылки молча пропускается', () => {
    expect(readSource('', 'habr')).toBeUndefined();
    expect(readSource('', 'ref_habr')).toBeUndefined();
  });

  it('форма проверяется, а не берётся на веру', () => {
    // Значение приходит из адреса и уезжает в базу и в отчёт письмом с HTML.
    expect(readSource('', 'from_<b>')).toBeUndefined();
    expect(readSource('', 'from_ха бр')).toBeUndefined();
    expect(readSource('', `from_${'a'.repeat(33)}`)).toBeUndefined();
    expect(readSource('', `from_${'a'.repeat(32)}`)).toBe('a'.repeat(32));
    // Ведущий разделитель — уже не имя канала, а мусор из чьей-то ссылки.
    expect(readSource('', 'from_-habr')).toBeUndefined();
  });

  it('регистр и пробелы по краям не заводят второй канал', () => {
    // «Habr» и «habr» в отчёте выглядели бы двумя источниками из одного.
    expect(readSource('', 'from_HABR')).toBe('habr');
    expect(readSource('?from=%20habr%20', undefined)).toBe('habr');
  });

  it('адресная строка идёт первой', () => {
    // Внутри Telegram адрес задают настройки бота, и `from` там взяться неоткуда;
    // если он всё же появился — его поставил человек, а не настройка.
    expect(readSource('?from=habr', 'from_site')).toBe('habr');
  });
});
