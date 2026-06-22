export interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType?: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  asset: string;
  extra?: Record<string, unknown>;
}

export interface X402FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Hex private key for direct EIP-3009 signing (e.g., '0xabc...'). Takes precedence over sessionKey. */
  privateKey?: string;
  /** CDP session key for smart wallet signing (not yet implemented). */
  sessionKey?: string;
  evmAddress?: string;
  autoApproveThreshold?: number;
  dailyLimit?: number;
  dailySpent?: number;
}

export interface X402FetchResult {
  paid: boolean;
  response?: Response;
  txHash?: string;
  requiresApproval?: boolean;
  amount?: number;
  paymentRequirements?: PaymentRequirements;
  error?: string;
}

export type PaymentRouteDecision = {
  rail: 'x402' | 'browser-checkout';
  reason: string;
};
