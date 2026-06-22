import type { MachineRail, OrderSpec, Settlement } from '@tomo/core';
import { NotImplementedError } from '@tomo/core';

/** Stub MachineRail. P0 settlement is wired in a deferred phase. */
export class MachineRailStub implements MachineRail {
  async pay(_vendorId: string, _amountCents: number, _order: OrderSpec): Promise<Settlement> {
    throw new NotImplementedError('rails-x402.pay');
  }
  async setControls(_c: { dailyCents?: number; perTxCents?: number; allowedVendors?: string[] }): Promise<void> {
    throw new NotImplementedError('rails-x402.setControls');
  }
}
