import { describe, it, expect } from 'vitest';
import { NotImplementedError } from '@tomo/core';
import { X402Rail } from './index.js';

describe('X402Rail (MachineRail — P0 settlement deferred to phase-10)', () => {
  const rail = new X402Rail();

  it('rejects pay with NotImplementedError until phase-10 wires settlement', async () => {
    await expect(
      rail.pay('v', 100, {
        vendorId: 'v',
        items: [{ name: 'x', qty: 1, unitCents: 100 }],
        totalCents: 100,
      }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('rejects setControls with NotImplementedError', async () => {
    await expect(rail.setControls({ dailyCents: 1000 })).rejects.toBeInstanceOf(NotImplementedError);
  });
});
