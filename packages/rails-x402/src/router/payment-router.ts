import type { PaymentRouteDecision } from '../client/types.js';
import { parsePaymentRequirements, getAmountInUSD } from '../client/payment-handler.js';

export interface RoutePaymentOptions {
  url: string;
  amount?: number;
  preferX402?: boolean;
  usdcBalance?: number;
  x402Enabled?: boolean;
}

/**
 * Smart router that determines whether to use x402 or browser checkout.
 * Probes the URL for 402 support and checks USDC balance.
 */
export async function routePayment(options: RoutePaymentOptions): Promise<PaymentRouteDecision> {
  const {
    url,
    preferX402 = true,
    usdcBalance = 0,
    x402Enabled = false,
  } = options;

  // If x402 is not enabled, always use browser checkout
  if (!x402Enabled) {
    return { rail: 'browser-checkout', reason: 'x402 not enabled' };
  }

  try {
    // Probe the URL with a HEAD request to check for 402 support
    const probeResponse = await fetch(url, { method: 'HEAD' });

    if (probeResponse.status === 402) {
      const requirements = parsePaymentRequirements(probeResponse);

      if (!requirements) {
        return { rail: 'browser-checkout', reason: 'Could not parse x402 payment requirements' };
      }

      const amountUSD = getAmountInUSD(requirements);

      // Check if we have enough USDC balance
      if (usdcBalance < amountUSD) {
        return {
          rail: 'browser-checkout',
          reason: `Insufficient USDC balance ($${usdcBalance.toFixed(2)} < $${amountUSD.toFixed(2)})`,
        };
      }

      return { rail: 'x402', reason: `URL supports x402 payment ($${amountUSD.toFixed(2)} USDC)` };
    }

    // URL doesn't return 402, use browser checkout
    return { rail: 'browser-checkout', reason: 'URL does not support x402' };
  } catch {
    // If probe fails, fall back to browser checkout
    return { rail: 'browser-checkout', reason: 'Failed to probe URL for x402 support' };
  }
}
