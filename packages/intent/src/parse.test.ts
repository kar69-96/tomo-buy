import { describe, it, expect } from 'vitest';
import {
  parseIntent,
  detectAccountBound,
  resolveCeiling,
  DEFAULT_PRICE_CEILING_CENTS,
  type CompleteFn,
} from './parse.js';

/** Build a mock model client that always returns the given JSON object as text. */
function mockModel(payload: unknown): CompleteFn {
  return async () => JSON.stringify(payload);
}

/** A mock that returns arbitrary raw text (for malformed-output cases). */
function mockRaw(text: string): CompleteFn {
  return async () => text;
}

const validPayload = {
  merchant_id: 'guest-goods-co',
  cart_spec: { natural: 'a large pepperoni pizza' },
  price_ceiling_cents: 4000,
};

describe('detectAccountBound', () => {
  it.each([
    'order my usual from the pizza place',
    'use my credit at checkout',
    'reorder last week’s groceries',
    'same as last time please',
    'get my previous order again',
  ])('flags account-bound phrasing: %s', (text) => {
    expect(detectAccountBound(text)).toBe(true);
  });

  it.each([
    'buy a large pepperoni pizza',
    'order sushi for tonight under $40',
    'get me a bag of coffee beans',
  ])('does not flag neutral phrasing: %s', (text) => {
    expect(detectAccountBound(text)).toBe(false);
  });
});

describe('resolveCeiling', () => {
  it('uses an explicit positive integer ceiling', () => {
    expect(resolveCeiling(4000)).toEqual({ cents: 4000, defaulted: false });
  });

  it('defaults when the price is null', () => {
    expect(resolveCeiling(null)).toEqual({
      cents: DEFAULT_PRICE_CEILING_CENTS,
      defaulted: true,
    });
  });

  it('defaults when the price is missing/undefined', () => {
    expect(resolveCeiling(undefined)).toEqual({
      cents: DEFAULT_PRICE_CEILING_CENTS,
      defaulted: true,
    });
  });

  it('defaults when the price is zero or negative', () => {
    expect(resolveCeiling(0).defaulted).toBe(true);
    expect(resolveCeiling(-100).defaulted).toBe(true);
  });
});

describe('parseIntent', () => {
  it('returns a schema-valid TaskIntent for a well-formed model response', async () => {
    const { intent, ceilingDefaulted } = await parseIntent(
      'user_1',
      'buy a large pepperoni pizza for $40',
      { complete: mockModel(validPayload) },
    );
    expect(intent.merchant_id).toBe('guest-goods-co');
    expect(intent.price_ceiling_cents).toBe(4000);
    expect(intent.cart_spec.natural).toBe('a large pepperoni pizza');
    expect(intent.ship_to_ref).toBe('vaultB:user_1:default');
    expect(ceilingDefaulted).toBe(false);
  });

  it('sets account_bound from the original text, not the model output', async () => {
    // Model omits account_bound entirely (it must not emit it); detection is trusted-side.
    const { intent } = await parseIntent(
      'user_1',
      'order my usual from guest-goods-co',
      { complete: mockModel(validPayload) },
    );
    expect(intent.account_bound).toBe(true);
  });

  it('leaves account_bound false for neutral text', async () => {
    const { intent } = await parseIntent(
      'user_1',
      'buy a large pepperoni pizza',
      { complete: mockModel(validPayload) },
    );
    expect(intent.account_bound).toBe(false);
  });

  it('applies the $50 default and flags it when the model gives no price', async () => {
    const { intent, ceilingDefaulted } = await parseIntent(
      'user_1',
      'get me a bag of coffee beans',
      { complete: mockModel({ ...validPayload, price_ceiling_cents: null }) },
    );
    expect(intent.price_ceiling_cents).toBe(DEFAULT_PRICE_CEILING_CENTS);
    expect(ceilingDefaulted).toBe(true);
  });

  it('never emits a path or lane key on the returned intent', async () => {
    const { intent } = await parseIntent('user_1', 'buy a pizza', {
      complete: mockModel(validPayload),
    });
    expect(intent).not.toHaveProperty('path');
    expect(intent).not.toHaveProperty('lane');
  });

  it('throws when the model sneaks an extra field like `path` (strict raw schema)', async () => {
    await expect(
      parseIntent('user_1', 'buy a pizza', {
        complete: mockModel({ ...validPayload, path: 'P0' }),
      }),
    ).rejects.toThrow();
  });

  it('throws when the price is a float (dollars, not cents)', async () => {
    await expect(
      parseIntent('user_1', 'buy a pizza', {
        complete: mockModel({ ...validPayload, price_ceiling_cents: 39.99 }),
      }),
    ).rejects.toThrow();
  });

  it('throws when a required field is missing', async () => {
    await expect(
      parseIntent('user_1', 'buy a pizza', {
        complete: mockModel({ cart_spec: { natural: 'x' } }),
      }),
    ).rejects.toThrow();
  });

  it('throws on non-JSON model output', async () => {
    await expect(
      parseIntent('user_1', 'buy a pizza', {
        complete: mockRaw('I cannot help with that.'),
      }),
    ).rejects.toThrow(/non-JSON/);
  });

  it('throws when userId or text is empty', async () => {
    await expect(
      parseIntent('', 'buy a pizza', { complete: mockModel(validPayload) }),
    ).rejects.toThrow(/userId/);
    await expect(
      parseIntent('user_1', '   ', { complete: mockModel(validPayload) }),
    ).rejects.toThrow(/text/);
  });
});
