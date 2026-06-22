/**
 * @tomo/rails-x402 — the P0 machine rail (x402/MPP), PORTED from AgentPay.
 *
 * STATUS: this package compiles + tests the ported x402 client now (phase-01
 * owns the dir), but Step-2 routing, the P0 catalog, and the settlement wallet
 * are wired in a DEFERRED phase (phase-10). Until then `X402Rail.pay` /
 * `setControls` throw `NotImplementedError` — P0 is card-path-independent and
 * never touches Agentcard.
 *
 * SECRET-FLOW: the settlement wallet private key is server-side only and never
 * enters model context — the model emits a pay-intent handle, the trusted side
 * settles. The ported helpers below take the key as an explicit argument.
 */
import type { MachineRail, OrderSpec, Settlement } from '@tomo/core';
import { NotImplementedError } from '@tomo/core';

// Re-export the ported x402 client surface so downstream phases can wire it.
export { x402Fetch } from './client/x402-client.js';
export { routePayment, type RoutePaymentOptions } from './router/payment-router.js';
export { generateWallet } from './client/wallet.js';
export {
  parsePaymentRequirements,
  getAmountInUSD,
  getChain,
  getUSDCAddress,
  getUSDCBalanceOnChain,
  createPaymentHeader,
  executePayment,
} from './client/payment-handler.js';
export type {
  PaymentRequirements,
  X402FetchOptions,
  X402FetchResult,
  PaymentRouteDecision,
} from './client/types.js';

/**
 * X402Rail — `MachineRail` over Coinbase x402 (stablecoin-native HTTP 402).
 * DEFERRED: settlement is wired in phase-10. Methods fail loudly until then.
 */
export class X402Rail implements MachineRail {
  async pay(_catalogVendorId: string, _amountCents: number, _order: OrderSpec): Promise<Settlement> {
    throw new NotImplementedError('rails-x402.X402Rail.pay (P0 settlement wired in phase-10)');
  }
  async setControls(_c: {
    dailyCents?: number;
    perTxCents?: number;
    allowedVendors?: string[];
  }): Promise<void> {
    throw new NotImplementedError('rails-x402.X402Rail.setControls (P0 wiring deferred to phase-10)');
  }
}
