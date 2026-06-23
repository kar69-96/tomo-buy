/**
 * Shared test fakes. Excluded from coverage (these support tests, they are not
 * product code). The route unit tests use the in-memory `FakeTemporalPort`; the
 * integration test uses the REAL temporal adapter over the test env client.
 */
import type { BrowserDriver, FieldDescriptor } from '@tomo/executor';
import type { CardRef, PAN_CVV_EXP, Txn } from '@tomo/core';
import { WebhookEventStore } from '@tomo/funding';
import { guestMerchant } from '@tomo/profiles';
import type { CheckoutWorkflowArgs, CheckoutStatus, ApproveInput } from '@tomo/orchestrator';
import type { CompleteFn, GetProfile, TemporalPort } from '../ports.js';

/** A deterministic LLM stub returning a fixed raw-intent JSON. */
export function stubComplete(rawIntent: object): CompleteFn {
  return async () => JSON.stringify(rawIntent);
}

/** The canonical guest-merchant raw intent the stub LLM returns. */
export const GUEST_RAW_INTENT = {
  merchant_id: guestMerchant.merchant_id,
  cart_spec: { natural: 'one widget for guest checkout' },
  price_ceiling_cents: 2000,
};

/** getProfile over the seeded guest merchant. */
export function fakeGetProfile(): GetProfile {
  return (id) => (id === guestMerchant.merchant_id ? guestMerchant : undefined);
}

/** In-memory TemporalPort for fast, deterministic route tests. */
export class FakeTemporalPort implements TemporalPort {
  readonly started: { args: CheckoutWorkflowArgs; workflowId: string }[] = [];
  readonly approved: { workflowId: string; input: ApproveInput }[] = [];
  readonly rejected: string[] = [];
  readonly statusByWf = new Map<string, CheckoutStatus>();
  failStatus = false;
  failStart = false;

  async start(args: CheckoutWorkflowArgs, workflowId: string): Promise<void> {
    if (this.failStart) throw new Error('temporal start failed');
    this.started.push({ args, workflowId });
    this.statusByWf.set(workflowId, 'AWAITING_APPROVAL');
  }
  async approve(workflowId: string, input: ApproveInput): Promise<void> {
    this.approved.push({ workflowId, input });
    this.statusByWf.set(workflowId, 'SETTLED');
  }
  async reject(workflowId: string): Promise<void> {
    this.rejected.push(workflowId);
    this.statusByWf.set(workflowId, 'ABANDONED');
  }
  async status(workflowId: string): Promise<CheckoutStatus> {
    if (this.failStatus) throw new Error('status query failed');
    return this.statusByWf.get(workflowId) ?? 'CART_BUILT';
  }
}

/** Distinctive secret fixtures — grep the transcript/logs for these to prove no leak. */
export const SECRET = {
  pan: '4111111111110042',
  cvv: '0042',
  expiry: '12/30',
} satisfies PAN_CVV_EXP;

export const PII = {
  name: 'Ada Lovelace',
  street: '1 Analytical Way',
  city: 'London',
  state: 'NA',
  zip: '90210',
  country: 'GB',
  email: 'ada@secret.example',
  phone: '+15550009999',
} as const;

/** Every distinctive secret/PII value that must NEVER appear in a transcript/log. */
export const ALL_SECRET_VALUES: readonly string[] = [
  SECRET.pan,
  SECRET.cvv,
  SECRET.expiry,
  ...Object.values(PII),
];

/**
 * A BrowserDriver standing in for a guest checkout form already on screen. It
 * captures the atomic-swap map so a test can assert the real values went through
 * the DOM swap — and never appeared in the agent transcript.
 */
export class FakeCheckoutDriver implements BrowserDriver {
  lastSwapMap: Record<string, string> = {};
  swapScript = '';

  private readonly fields: FieldDescriptor[] = [
    { selector: '#card_number', name: 'card_number' },
    { selector: '#card_cvv', name: 'card_cvv' },
    { selector: '#card_expiry', name: 'card_expiry' },
    { selector: '#cardholder_name', name: 'cardholder_name' },
    { selector: '#email', name: 'email' },
    { selector: '#phone', name: 'phone' },
    { selector: '#shipping_street', name: 'shipping_street' },
    { selector: '#shipping_city', name: 'shipping_city' },
    { selector: '#shipping_state', name: 'shipping_state' },
    { selector: '#shipping_zip', name: 'shipping_zip' },
    { selector: '#shipping_country', name: 'shipping_country' },
  ];

  async goto(): Promise<void> {}
  async setContent(): Promise<void> {}
  async discoverFields(): Promise<FieldDescriptor[]> {
    return [...this.fields];
  }
  async fillField(): Promise<void> {}
  async evaluateSwap(scriptString: string, swapMap: Record<string, string>): Promise<void> {
    this.swapScript = scriptString;
    this.lastSwapMap = { ...swapMap };
  }
  async readValue(): Promise<string> {
    return 'CONF-LIVE-001';
  }
  async getPageText(): Promise<string> {
    return 'Order summary: one widget. Thank you for shopping.';
  }
  async close(): Promise<void> {}
}

/** A fake funding rail (issue/close/list) that projects the shared event store. */
export class FakeFundingRail {
  closed: string[] = [];
  constructor(private readonly store: WebhookEventStore) {}

  async issueCard(userId: string, amountCents: number, merchantId: string): Promise<CardRef> {
    return {
      cardId: `card-${userId}`,
      cardholderId: `ch-${userId}`,
      merchantId,
      amountCents,
      status: 'active',
    };
  }
  async closeCard(cardRef: CardRef): Promise<void> {
    this.closed.push(cardRef.cardId);
  }
  async getCardSecret(): Promise<PAN_CVV_EXP> {
    return SECRET;
  }
  async listTransactions(cardRef: CardRef): Promise<Txn[]> {
    return this.store
      .byCard(cardRef.cardId)
      .filter((e) => e.type === 'transaction.authorized' || e.type === 'transaction.cleared')
      .map((e) => ({
        txId: e.txId ?? `tx-${e.cardId}`,
        cardId: e.cardId,
        amountCents: e.amountCents ?? 0,
        status: e.type === 'transaction.cleared' ? 'cleared' : 'authorized',
        occurredAt: e.occurredAt,
      }));
  }
}
