import type { X402FetchOptions, X402FetchResult } from './types.js';
import { parsePaymentRequirements, getAmountInUSD, executePayment, createPaymentHeader } from './payment-handler.js';

export async function x402Fetch(
  url: string,
  options: X402FetchOptions = {},
): Promise<X402FetchResult> {
  const {
    method = 'GET',
    headers = {},
    body,
    privateKey,
    sessionKey,
    evmAddress,
    autoApproveThreshold = 0.10,
    dailyLimit = 10.00,
    dailySpent = 0,
  } = options;

  try {
    // Step 1: Make initial request
    const initialResponse = await fetch(url, { method, headers, body });

    // Step 2: If not 402, return as-is
    if (initialResponse.status !== 402) {
      return { paid: false, response: initialResponse };
    }

    // Step 3: Parse payment requirements from 402 response
    const requirements = parsePaymentRequirements(initialResponse);
    if (!requirements) {
      return {
        paid: false,
        error: 'Received 402 but could not parse payment requirements',
        response: initialResponse,
      };
    }

    const amountUSD = getAmountInUSD(requirements);

    // Step 4: Check against auto-approve threshold and daily limit
    if (amountUSD > autoApproveThreshold) {
      return {
        paid: false,
        requiresApproval: true,
        amount: amountUSD,
        paymentRequirements: requirements,
      };
    }

    if (dailySpent + amountUSD > dailyLimit) {
      return {
        paid: false,
        requiresApproval: true,
        amount: amountUSD,
        paymentRequirements: requirements,
        error: `Daily limit would be exceeded (spent: $${dailySpent.toFixed(2)}, limit: $${dailyLimit.toFixed(2)})`,
      };
    }

    // Step 5: Execute payment
    // Path A: Direct private key signing (EIP-3009)
    if (privateKey) {
      const xPaymentHeader = await createPaymentHeader(
        requirements,
        privateKey as `0x${string}`,
      );

      // Step 6: Retry request with X-PAYMENT header
      const paidResponse = await fetch(url, {
        method,
        headers: {
          ...headers,
          'X-PAYMENT': xPaymentHeader,
        },
        body,
      });

      if (paidResponse.ok) {
        return {
          paid: true,
          response: paidResponse,
          amount: amountUSD,
          paymentRequirements: requirements,
        };
      }

      // Payment was rejected by the facilitator
      const errorBody = await paidResponse.text().catch(() => '');
      return {
        paid: false,
        response: paidResponse,
        amount: amountUSD,
        paymentRequirements: requirements,
        error: `Payment rejected (HTTP ${paidResponse.status}): ${errorBody}`.trim(),
      };
    }

    // Path B: CDP session key signing (legacy, not yet implemented)
    if (sessionKey && evmAddress) {
      const paymentResult = await executePayment(
        requirements,
        sessionKey,
        evmAddress,
        requirements.network,
      );

      if ('error' in paymentResult) {
        return {
          paid: false,
          amount: amountUSD,
          paymentRequirements: requirements,
          error: paymentResult.error,
        };
      }

      const paidResponse = await fetch(url, {
        method,
        headers: {
          ...headers,
          'X-PAYMENT': paymentResult.txHash,
        },
        body,
      });

      return {
        paid: true,
        response: paidResponse,
        txHash: paymentResult.txHash,
        amount: amountUSD,
        paymentRequirements: requirements,
      };
    }

    // No payment method configured
    return {
      paid: false,
      requiresApproval: true,
      amount: amountUSD,
      paymentRequirements: requirements,
      error: 'No session key or wallet address configured',
    };
  } catch (err) {
    return {
      paid: false,
      error: err instanceof Error ? err.message : 'x402 fetch failed',
    };
  }
}
