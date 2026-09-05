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
    expect(readSource('', 'src_habr')).toBe('habr');
    expect(readSource('', 'src_product-hunt')).toBe('product-hunt');
  });

  it('приезжает адресной строкой в браузере', () => {
    expect(readSource('?utm_source=habr', undefined)).toBe('habr');
    expect(readSource('?lang=en&utm_source=site-en', undefined)).toBe('site-en');
  });

  it('без метки её и нет', () => {
    expect(readSource('', undefined)).toBeUndefined();
    expect(readSource('?lang=en', undefined)).toBeUndefined();
    expect(readSource('?utm_source=', undefined)).toBeUndefined();
    // Старое имя параметра больше не читается — до выката его нигде не было.
    expect(readSource('?from=habr', undefined)).toBeUndefined();
  });

  it('демо-приглашение без метки меткой не считается', () => {
    // `startapp` один на всех, и `demo_` занят раньше. Без префикса метка
    // притащила бы в базу источник «max» на каждого, кто открыл чужую жизнь.
    expect(readSource('', 'demo_max')).toBeUndefined();
    expect(readSource('', 'demo_burnout')).toBeUndefined();
  });

  it('демо-приглашение с меткой отдаёт метку, а не профиль', () => {
    // Ссылка из карточки каталога: демо и метка едут одним `startapp`.
    // Без этого посетитель, нажавший демо-ссылку, для канала не существует.
    expect(readSource('', 'demo_max_src_productradar')).toBe('productradar');
    expect(readSource('', 'demo_f_src_habr')).toBe('habr');
  });

  it('чужой хвост ссылки молча пропускается', () => {
    expect(readSource('', 'habr')).toBeUndefined();
    expect(readSource('', 'ref_habr')).toBeUndefined();
    expect(readSource('', 'from_habr')).toBeUndefined();
  });

  it('форма проверяется, а не берётся на веру', () => {
    // Значение приходит из адреса и уезжает в базу и в отчёт письмом с HTML.
    expect(readSource('', 'src_<b>')).toBeUndefined();
    expect(readSource('', 'src_ха бр')).toBeUndefined();
    expect(readSource('', `src_${'a'.repeat(33)}`)).toBeUndefined();
    expect(readSource('', `src_${'a'.repeat(32)}`)).toBe('a'.repeat(32));
    // Ведущий разделитель — уже не имя канала, а мусор из чьей-то ссылки.
    expect(readSource('', 'src_-habr')).toBeUndefined();
    expect(readSource('', 'demo_max_src_')).toBeUndefined();
  });

  it('регистр и пробелы по краям не заводят второй канал', () => {
    // «Habr» и «habr» в отчёте выглядели бы двумя источниками из одного.
    expect(readSource('', 'src_HABR')).toBe('habr');
    // Ссылку в карточке каталога правит модератор: регистр может измениться весь.
    expect(readSource('', 'SRC_HABR')).toBe('habr');
    expect(readSource('', 'DEMO_max_SRC_habr')).toBe('habr');
    expect(readSource('?utm_source=%20habr%20', undefined)).toBe('habr');
  });

  it('адресная строка идёт первой', () => {
    // Внутри Telegram адрес задают настройки бота, и `utm_source` там взяться
    // неоткуда; если он всё же появился — его поставил человек, а не настройка.
    expect(readSource('?utm_source=habr', 'src_site')).toBe('habr');
  });
});
