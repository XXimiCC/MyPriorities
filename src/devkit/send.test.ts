import { describe, expect, it } from 'vitest';

import { pickHeaders } from './send';

/*
 * Сторож на потерянные тикеты.
 *
 * Ключ из ссылки долго был не самостоятельной дверью, а добавкой к входу — и
 * на документации с лендингом, где входа нет вовсе, отправка молча отказывала
 * при совершенно правильном ключе. Сервер такие тикеты принимал; не доезжали
 * они ровно из-за этого выбора заголовков.
 */

describe('чем доказываем, что это свои', () => {
  it('токен сессии сильнее всего', () => {
    expect(pickHeaders({ token: 'жетон', devToken: 'ключ', invite: 'ссылка' })).toEqual({
      Authorization: 'Bearer жетон',
      'X-Devkit-Invite': 'ссылка',
    });
  });

  it('ключ разработчика идёт вторым', () => {
    expect(pickHeaders({ devToken: 'ключ' })).toEqual({ 'X-Devkit-Token': 'ключ' });
  });

  it('ключ из ссылки работает сам по себе', () => {
    // Главное правило этого файла: на сайте без входа он единственная дверь.
    expect(pickHeaders({ invite: 'ссылка' })).toEqual({ 'X-Devkit-Invite': 'ссылка' });
  });

  it('ключ из ссылки едет вместе с ключом разработчика', () => {
    expect(pickHeaders({ devToken: 'ключ', invite: 'ссылка' })).toEqual({
      'X-Devkit-Token': 'ключ',
      'X-Devkit-Invite': 'ссылка',
    });
  });

  it('без единого ключа заголовков нет', () => {
    expect(pickHeaders({})).toBeUndefined();
    expect(pickHeaders({ token: '', devToken: '', invite: '' })).toBeUndefined();
  });
});
