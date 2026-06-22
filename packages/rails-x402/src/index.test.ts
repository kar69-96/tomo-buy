import { describe, it, expect } from 'vitest';
import { NotImplementedError } from '@tomo/core';
import { MachineRailStub } from './index.js';

describe('MachineRailStub', () => {
  const stub = new MachineRailStub();
  it('rejects pay with NotImplementedError', async () => {
    await expect(stub.pay('v', 100, { vendorId: 'v', items: [{ name: 'x', qty: 1, unitCents: 100 }], totalCents: 100 })).rejects.toBeInstanceOf(NotImplementedError);
  });
});
