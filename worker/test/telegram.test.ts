import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { INIT_DATA_MAX_AGE_SECONDS, verifyInitData } from '../src/telegram';

const TOKEN = '123456:AAHtesttokenvalue';
const NOW = Date.UTC(2026, 7, 8, 12, 0, 0);

/**
 * Подпись собирается встречной реализацией на node:crypto и своей склейкой
 * строки. Проверять код собственными же функциями значило бы сверять его сам с
 * собой: одинаковая ошибка в обеих половинах прошла бы незамеченной.
 */
function sign(fields: Record<string, string>, token = TOKEN): string {
  const checkString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(checkString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

function fields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    auth_date: String(Math.floor(NOW / 1000)),
    query_id: 'AAH_test',
    user: JSON.stringify({ id: 4242, username: 'andrii', first_name: 'Андрій' }),
    ...overrides,
  };
}

describe('проверка initData', () => {
  it('пропускает свежую подпись и отдаёт пользователя', async () => {
    const user = await verifyInitData(sign(fields()), TOKEN, NOW);
    expect(user).toEqual({ id: 4242, username: 'andrii', firstName: 'Андрій' });
  });

  it('порядок полей в строке значения не имеет', async () => {
    // Telegram не обещает порядок, а строка проверки сортируется по ключу.
    const params = new URLSearchParams(sign(fields()));
    const shuffled = new URLSearchParams();
    for (const [key, value] of [...params].reverse()) shuffled.append(key, value);
    await expect(verifyInitData(shuffled.toString(), TOKEN, NOW)).resolves.toMatchObject({
      id: 4242,
    });
  });

  it('поле signature в расчёт не идёт', async () => {
    // Оно появилось позже hash и в его расчёт не входит: учтёшь — и подпись
    // перестанет сходиться на новых клиентах.
    const signed = `${sign(fields())}&signature=${encodeURIComponent('чужое')}`;
    await expect(verifyInitData(signed, TOKEN, NOW)).resolves.toMatchObject({ id: 4242 });
  });

  it('подделанное поле не проходит', async () => {
    const params = new URLSearchParams(sign(fields()));
    params.set('user', JSON.stringify({ id: 1, username: 'чужой' }));
    await expect(verifyInitData(params.toString(), TOKEN, NOW)).rejects.toThrow('bad-signature');
  });

  it('чужой токен не проходит', async () => {
    const signed = sign(fields(), '999:другой');
    await expect(verifyInitData(signed, TOKEN, NOW)).rejects.toThrow('bad-signature');
  });

  it('просроченная подпись не проходит', async () => {
    // Перехваченная строка иначе годилась бы вечно.
    const old = Math.floor(NOW / 1000) - INIT_DATA_MAX_AGE_SECONDS - 1;
    const signed = sign(fields({ auth_date: String(old) }));
    await expect(verifyInitData(signed, TOKEN, NOW)).rejects.toThrow('expired');
  });

  it('подпись из будущего тоже не проходит', async () => {
    const ahead = Math.floor(NOW / 1000) + INIT_DATA_MAX_AGE_SECONDS + 60;
    const signed = sign(fields({ auth_date: String(ahead) }));
    await expect(verifyInitData(signed, TOKEN, NOW)).rejects.toThrow('expired');
  });

  it('на границе срока ещё проходит', async () => {
    const edge = Math.floor(NOW / 1000) - INIT_DATA_MAX_AGE_SECONDS;
    const signed = sign(fields({ auth_date: String(edge) }));
    await expect(verifyInitData(signed, TOKEN, NOW)).resolves.toMatchObject({ id: 4242 });
  });

  it('без обязательных полей не проходит', async () => {
    await expect(verifyInitData('', TOKEN, NOW)).rejects.toThrow('empty');
    await expect(verifyInitData('user=x&auth_date=1', TOKEN, NOW)).rejects.toThrow('no-hash');

    const noUser = sign({ auth_date: String(Math.floor(NOW / 1000)) });
    await expect(verifyInitData(noUser, TOKEN, NOW)).rejects.toThrow('no-user');

    const badUser = sign(fields({ user: 'не json' }));
    await expect(verifyInitData(badUser, TOKEN, NOW)).rejects.toThrow('bad-user');

    const noId = sign(fields({ user: JSON.stringify({ username: 'нет id' }) }));
    await expect(verifyInitData(noId, TOKEN, NOW)).rejects.toThrow('bad-user');
  });

  it('необязательные поля пользователя могут отсутствовать', async () => {
    const signed = sign(fields({ user: JSON.stringify({ id: 7 }) }));
    await expect(verifyInitData(signed, TOKEN, NOW)).resolves.toEqual({ id: 7 });
  });

  it('настоящий набор полей с кириллицей и ссылками проходит', async () => {
    /*
     * Форма взята из живого захода: auth_date, chat_instance, user. Смысл теста
     * не в полях как таковых, а в кодировании: значения приезжают
     * процентно-закодированными, а в строку проверки идут раскодированными.
     * Ошибись здесь на один шаг — и подпись не сойдётся ровно на тех данных,
     * где есть кириллица, двоеточия и косые черты, то есть всегда.
     */
    const user = JSON.stringify({
      id: 279058397,
      first_name: 'Андрій',
      last_name: 'Гетьманенко',
      username: 'andrii',
      language_code: 'ru',
      is_premium: true,
      allows_write_to_pm: true,
      photo_url: 'https://t.me/i/userpic/320/abc-DEF_123.svg',
    });

    const signed = sign({
      auth_date: String(Math.floor(NOW / 1000)),
      chat_instance: '-3336887971990173897',
      user,
    });

    // Так строку собирает сам Telegram: encodeURIComponent на каждое значение.
    expect(signed).toContain('%D0%90'); // «А» кириллическая — значит, кодирование живое
    await expect(verifyInitData(signed, TOKEN, NOW)).resolves.toMatchObject({
      id: 279058397,
      username: 'andrii',
      firstName: 'Андрій',
    });
  });

  it('поле, о котором мы не знаем, в подпись всё равно входит', async () => {
    // Telegram добавляет поля со временем. Пропустить незнакомое значило бы
    // перестать сходиться подписью на всех новых клиентах разом.
    const signed = sign(fields({ chat_type: 'sender', start_param: 'ref_42' }));
    await expect(verifyInitData(signed, TOKEN, NOW)).resolves.toMatchObject({ id: 4242 });
  });
});
