import { describe, it, expect } from 'vitest';
import { Cents, IsoDateTime } from './common.js';

describe('Cents', () => {
  it('accepts a non-negative integer', () => {
    expect(Cents.parse(0)).toBe(0);
    expect(Cents.parse(4000)).toBe(4000);
  });

  it('rejects a float dollar amount (cents rule)', () => {
    expect(() => Cents.parse(39.99)).toThrow();
  });

  it('rejects a negative amount', () => {
    expect(() => Cents.parse(-1)).toThrow();
  });

  it('rejects a non-number', () => {
    expect(() => Cents.parse('4000')).toThrow();
  });
});

describe('IsoDateTime', () => {
  it('accepts a valid ISO 8601 string', () => {
    const s = '2026-06-22T17:00:00.000Z';
    expect(IsoDateTime.parse(s)).toBe(s);
  });

  it('rejects an empty string', () => {
    expect(() => IsoDateTime.parse('')).toThrow();
  });

  it('rejects an unparseable date', () => {
    expect(() => IsoDateTime.parse('not-a-date')).toThrow();
  });
});
