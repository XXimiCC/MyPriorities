/**
 * Ночной отчёт: то, ради чего метка источника вообще писалась.
 *
 * Записанная, но нечитаемая метка отвечает на вопрос «пришёл ли кто-нибудь»
 * ровно так же, как незаписанная, — то есть никак. Поэтому строка разбивки
 * проверяется так же, как сама метка.
 */

import { describe, expect, it } from 'vitest';

import { formatReport, type Usage } from '../src/report';

function usage(extra: Partial<Usage> = {}): Usage {
  return {
    users: 12,
    devices: 15,
    ops: 900,
    snapshots: 3,
    estimatedBytes: 900 * 250 + 3 * 1200,
    openTickets: 0,
    sources: [],
    ...extra,
  };
}

describe('разбивка по источникам в отчёте', () => {
  it('каналы печатаются по убыванию', () => {
    const text = formatReport(
      usage({
        sources: [
          { name: 'habr', count: 7 },
          { name: 'product-hunt', count: 2 },
        ],
      }),
    );
    expect(text).toContain('Откуда пришли: habr — 7, product-hunt — 2');
  });

  it('без размеченных приходов строки нет вовсе', () => {
    // Пустая строка каждую ночь приучает не читать отчёт целиком.
    expect(formatReport(usage())).not.toContain('Откуда пришли');
  });

  it('остальной отчёт остался прежним', () => {
    const text = formatReport(usage({ sources: [{ name: 'habr', count: 7 }] }));
    expect(text).toContain('Людей: 12, устройств: 15');
    expect(text).toContain('Операций: 900, свёрток: 3');
  });
});
