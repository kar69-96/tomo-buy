import { describe, it, expect } from 'vitest';
import {
  PLACEHOLDER_MAP,
  getPlaceholderVariables,
  credentialsToSwapMap,
  getAtomicSwapScript,
  type BillingCredentials,
} from './placeholder.js';

describe('placeholder (verbatim port)', () => {
  it('PLACEHOLDER_MAP uses {{var}} markers', () => {
    expect(PLACEHOLDER_MAP.card_number).toBe('{{card_number}}');
    expect(PLACEHOLDER_MAP.shipping_zip).toBe('{{shipping_zip}}');
    expect(Object.keys(PLACEHOLDER_MAP)).toHaveLength(16);
  });

  it('getPlaceholderVariables returns the %var% set the agent sees', () => {
    const vars = getPlaceholderVariables();
    expect(vars.card_number).toBe('%card_number%');
    expect(vars.email).toBe('%email%');
    // Every placeholder var is a %wrapped% token — never a real value.
    for (const v of Object.values(vars)) {
      expect(v).toMatch(/^%[a-z_]+%$/);
    }
  });

  it('credentialsToSwapMap maps {{markers}} to real values', () => {
    const creds: BillingCredentials = {
      card: { number: '4111111111110042', expiry: '12/30', cvv: '123' },
      name: 'Ada Lovelace',
      billingAddress: { street: '1 A', city: 'London', state: 'NA', zip: '90210', country: 'GB' },
      shippingAddress: { street: '1 A', city: 'London', state: 'NA', zip: '90210', country: 'GB' },
      email: 'ada@example.com',
      phone: '+15551234567',
    };
    const map = credentialsToSwapMap(creds);
    expect(map['{{card_number}}']).toBe('4111111111110042');
    expect(map['{{email}}']).toBe('ada@example.com');
  });

  it('getAtomicSwapScript is a self-contained swap+submit function string', () => {
    const script = getAtomicSwapScript();
    expect(script).toContain('(swapMap) =>');
    expect(script).toContain("dispatchEvent(new Event('input'");
    expect(script).toContain("dispatchEvent(new Event('change'");
    expect(script).toContain('submitBtn');
  });
});
