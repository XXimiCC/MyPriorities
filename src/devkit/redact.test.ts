import { describe, expect, it } from 'vitest';

import { CUT, redact, redactRecord } from './redact';

describe('что проходит как есть', () => {
  it('числа, булевы и короткие перечисления', () => {
    expect(redact({ priorities: 7, onboarded: true, sync: 'signed-in' })).toEqual({
      priorities: 7,
      onboarded: true,
      sync: 'signed-in',
    });
  });

  it('null и undefined остаются собой', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});

describe('что не проходит никогда', () => {
  it('ключи с личным выкидываются целиком', () => {
    // Ровно то, ради чего это написано: приоритет с настоящим названием.
    expect(redact({ id: 'ab', title: 'Терапия', colorId: 3 })).toEqual({ id: 'ab', colorId: 3 });
  });

  it('токены и initData не проходят даже под невинным именем', () => {
    expect(redact({ accessToken: 'x', refreshToken: 'y', initData: 'z', deviceId: 'ab' })).toEqual({
      deviceId: 'ab',
    });
  });

  it('длинная строка становится многоточием', () => {
    expect(redact('a'.repeat(41))).toBe(CUT);
    expect(redact('a'.repeat(40))).toBe('a'.repeat(40));
  });

  it('почта и JWT узнаются по форме, даже если короткие', () => {
    expect(redact('a@b.co')).toBe(CUT);
    expect(redact('+7 999 123-45-67')).toBe(CUT);
    expect(redact('https://app.example/?code=abc')).toBe(CUT);
    expect(redact('eyJhbGciOi.eyJzdWIiOi.sig')).toBe(CUT);
  });

  it('функции не сериализуются мусором', () => {
    expect(redact({ go: () => undefined })).toEqual({ go: CUT });
  });
});

describe('пределы обхода', () => {
  it('глубже четырёх уровней срезается', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(redact(deep)).toEqual({ a: { b: { c: { d: CUT } } } });
  });

  it('меньшая глубина — для крошек консоли', () => {
    expect(redact({ a: { b: 1 } }, 1)).toEqual({ a: CUT });
  });

  it('длинный массив обрезается', () => {
    const list = Array.from({ length: 50 }, (_, index) => index);
    expect(redact(list)).toHaveLength(20);
  });

  it('циклическая ссылка не вешает обход', () => {
    const node: Record<string, unknown> = { level: 1 };
    node.self = node;
    expect(() => redact(node)).not.toThrow();
    expect(redact(node)).toEqual({ level: 1, self: CUT });
  });
});

describe('запись на выходе', () => {
  it('массив записью не считается', () => {
    expect(redactRecord([1, 2])).toBeUndefined();
    expect(redactRecord('строка')).toBeUndefined();
  });

  it('объект проходит', () => {
    expect(redactRecord({ skills: 4 })).toEqual({ skills: 4 });
  });
});
