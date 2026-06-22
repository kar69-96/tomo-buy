import { describe, it, expect } from 'vitest';
import { NotImplementedError } from '@tomo/core';
import { ApiStub } from './index.js';

describe('ApiStub', () => {
  it('rejects submit with NotImplementedError', async () => {
    const intent = { merchant_id: 'm', cart_spec: { natural: 'x' }, price_ceiling_cents: 100, account_bound: false, ship_to_ref: 'r' };
    await expect(new ApiStub().submit(intent)).rejects.toBeInstanceOf(NotImplementedError);
  });
});
