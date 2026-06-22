import { describe, it, expect } from 'vitest';
import { TaskIntentSchema, CartSpecSchema } from './intent.js';
import type { TaskIntent } from './intent.js';

const intent: TaskIntent = {
  merchant_id: 'sushiplace.com',
  cart_spec: { natural: 'sushi under $40 from my usual place' },
  price_ceiling_cents: 4000,
  account_bound: true,
  ship_to_ref: 'vaultB:user_123:home_address',
};

describe('TaskIntentSchema', () => {
  it('round-trips a reference-only intent', () => {
    expect(TaskIntentSchema.parse(intent)).toEqual(intent);
  });

  it('rejects a float price_ceiling_cents (cents rule)', () => {
    expect(() => TaskIntentSchema.parse({ ...intent, price_ceiling_cents: 40.5 })).toThrow();
  });

  it('rejects a missing ship_to_ref', () => {
    const { ship_to_ref, ...partial } = intent;
    void ship_to_ref;
    expect(() => TaskIntentSchema.parse(partial)).toThrow();
  });

  it('accepts structured cart items', () => {
    const withItems = {
      ...intent,
      cart_spec: { natural: 'two rolls', items: [{ name: 'spicy tuna', qty: 2 }] },
    };
    expect(TaskIntentSchema.parse(withItems)).toEqual(withItems);
  });
});

describe('CartSpecSchema', () => {
  it('rejects an empty natural string', () => {
    expect(() => CartSpecSchema.parse({ natural: '' })).toThrow();
  });
});
