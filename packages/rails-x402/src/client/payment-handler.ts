import type { PaymentRequirements } from './types.js';
import { createPublicClient, createWalletClient, http, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { randomBytes } from 'node:crypto';

// USDC contract addresses
const USDC_ADDRESSES: Record<string, `0x${string}`> = {
  'base': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

// EIP-155 chain ID to network name mapping
const CHAIN_ID_MAP: Record<string, string> = {
  'eip155:8453': 'base',
  'eip155:84532': 'base-sepolia',
};

// Reverse mapping: network name to EIP-155 chain ID
const NETWORK_TO_EIP155: Record<string, string> = {
  'base': 'eip155:8453',
  'base-sepolia': 'eip155:84532',
};

// EIP-712 types for TransferWithAuthorization (EIP-3009)
const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

// Minimal ERC20 ABI for balanceOf
const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

function normalizeNetwork(network: string): string {
  return CHAIN_ID_MAP[network] || network;
}

function toEIP155(network: string): string {
  return NETWORK_TO_EIP155[network] || network;
}

function parseRequirementsFromJSON(raw: unknown): PaymentRequirements | null {
  try {
    const req = raw as Record<string, unknown>;
    return {
      scheme: (req.scheme as string) || 'exact',
      network: normalizeNetwork((req.network as string) || 'base'),
      maxAmountRequired: (req.maxAmountRequired as string) || (req.amount as string) || '0',
      resource: (req.resource as string) || '',
      description: (req.description as string) || '',
      mimeType: req.mimeType as string | undefined,
      payTo: (req.payTo as string) || '',
      maxTimeoutSeconds: req.maxTimeoutSeconds as number | undefined,
      asset: (req.asset as string) || USDC_ADDRESSES['base']!,
      extra: req.extra as Record<string, unknown> | undefined,
    };
  } catch {
    return null;
  }
}

export function parsePaymentRequirements(response: Response): PaymentRequirements | null {
  // Try X-PAYMENT-REQUIREMENTS header first (simple JSON format)
  const xHeader = response.headers.get('X-PAYMENT-REQUIREMENTS');
  if (xHeader) {
    try {
      const parsed = JSON.parse(xHeader);
      const req = Array.isArray(parsed) ? parsed[0] : parsed;
      return parseRequirementsFromJSON(req);
    } catch {
      // Fall through to try other formats
    }
  }

  // Try payment-required header (x402 v2 format: base64-encoded JSON with accepts array)
  const prHeader = response.headers.get('payment-required');
  if (prHeader) {
    try {
      const decoded = Buffer.from(prHeader, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded);

      // x402 v2 format: { accepts: [...], resource: { url, description, mimeType } }
      if (parsed.accepts && Array.isArray(parsed.accepts) && parsed.accepts.length > 0) {
        const accept = parsed.accepts[0];
        const resource = parsed.resource || {};
        return parseRequirementsFromJSON({
          ...accept,
          resource: resource.url || '',
          description: resource.description || '',
          mimeType: resource.mimeType,
        });
      }

      // Flat format in base64
      return parseRequirementsFromJSON(parsed);
    } catch {
      // Fall through
    }
  }

  return null;
}

export function getAmountInUSD(requirements: PaymentRequirements): number {
  // USDC has 6 decimals, amounts are in smallest unit
  const rawAmount = BigInt(requirements.maxAmountRequired);
  return Number(rawAmount) / 1e6;
}

export function getChain(network: string) {
  return network === 'base' ? base : baseSepolia;
}

export function getUSDCAddress(network: string): `0x${string}` {
  return USDC_ADDRESSES[network] || USDC_ADDRESSES['base-sepolia']!;
}

/**
 * Read on-chain USDC balance for an address.
 *
 * Network-only: this is a thin viem RPC wrapper against a live Base node, so it
 * is excluded from unit coverage (exercised by the deferred P0 e2e in phase-10).
 */
/* c8 ignore start */
export async function getUSDCBalanceOnChain(
  address: `0x${string}`,
  network: string = 'base-sepolia',
): Promise<number> {
  const chain = getChain(network);
  const usdcAddress = getUSDCAddress(network);

  const client = createPublicClient({
    chain,
    transport: http(),
  });

  const balance = await client.readContract({
    address: usdcAddress,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [address],
  });

  return Number(balance) / 1e6;
}
/* c8 ignore stop */

/**
 * Create a base64-encoded X-PAYMENT header by signing an EIP-3009
 * TransferWithAuthorization for the x402 facilitator.
 */
export async function createPaymentHeader(
  requirements: PaymentRequirements,
  privateKey: `0x${string}`,
): Promise<string> {
  const account = privateKeyToAccount(privateKey);
  const chain = getChain(requirements.network);

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(),
  });

  const now = Math.floor(Date.now() / 1000);
  const validAfter = BigInt(0); // Valid immediately
  const validBefore = BigInt(now + (requirements.maxTimeoutSeconds || 300));
  const nonce = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;

  // EIP-712 domain from payment requirements (extra.name and extra.version)
  const domain = {
    name: (requirements.extra?.name as string) || 'USDC',
    version: (requirements.extra?.version as string) || '2',
    chainId: chain.id,
    verifyingContract: requirements.asset as `0x${string}`,
  };

  const message = {
    from: account.address,
    to: requirements.payTo as `0x${string}`,
    value: BigInt(requirements.maxAmountRequired),
    validAfter,
    validBefore,
    nonce,
  };

  const signature = await walletClient.signTypedData({
    domain,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
  });

  const payload = {
    x402Version: 2,
    scheme: requirements.scheme,
    network: toEIP155(requirements.network),
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: requirements.payTo,
        value: requirements.maxAmountRequired,
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Legacy: Execute payment via CDP session key (not yet implemented).
 */
export async function executePayment(
  requirements: PaymentRequirements,
  sessionKey: string,
  evmAddress: string,
  network: string = 'base-sepolia',
): Promise<{ txHash: string } | { error: string }> {
  return {
    error: 'Session key signing not yet implemented. CDP smart wallet integration required.',
  };
}
