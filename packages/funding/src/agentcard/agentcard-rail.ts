import {
  FundingError,
  type FundingRail,
  type CardholderRef,
  type CardRef,
  type CardStatus,
  type PAN_CVV_EXP,
  type Txn,
  type TxnStatus,
  type ChargeEvent,
} from '@tomo/core';
import { AgentcardClient, AgentcardError, type CardResponse } from './client.js';
import { WebhookEventStore } from './event-store.js';

/** Per-card cents bounds (org default $1–$50; raising the ceiling needs Agentcard support). */
export const MIN_CARD_CENTS = 100;
export const MAX_CARD_CENTS = 5000;

/** Profile fields needed to create a cardholder the first time we see a user. */
export interface CardholderProfile {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phoneNumber: string;
  email: string;
}

export interface AgentcardRailOptions {
  client: AgentcardClient;
  /** Resolve the cardholder profile for a userId (trusted-side; never the LLM). */
  resolveProfile: (userId: string) => Promise<CardholderProfile> | CardholderProfile;
  /** Optional shared event store (defaults to a fresh in-memory store). */
  eventStore?: WebhookEventStore;
}

/**
 * AgentcardRail — `FundingRail` over the documented Agentcard REST API.
 *
 * SECRET-FLOW: `getCardSecret` returns `{ pan, cvv, expiry }` which flows ONLY
 * into the Executor's page-fill path. This class never logs it, never returns it
 * to the LLM, never persists it. Cents-only; rejects `amountCents > 5000`.
 */
export class AgentcardRail implements FundingRail {
  private readonly client: AgentcardClient;
  private readonly resolveProfile: AgentcardRailOptions['resolveProfile'];
  readonly eventStore: WebhookEventStore;

  constructor(opts: AgentcardRailOptions) {
    this.client = opts.client;
    this.resolveProfile = opts.resolveProfile;
    this.eventStore = opts.eventStore ?? new WebhookEventStore();
  }

  /** Create the cardholder if absent; 409 (duplicate email) means "already exists, reuse". */
  async ensureCardholder(userId: string): Promise<CardholderRef> {
    const profile = await this.resolveProfile(userId);
    try {
      const res = await this.client.createCardholder(profile);
      return { cardholderId: res.id, userId };
    } catch (err) {
      if (err instanceof AgentcardError && err.meta.status === 409) {
        const existingId = extractCardholderId(err.meta.body);
        if (existingId) return { cardholderId: existingId, userId };
        throw new FundingError(
          `Cardholder already exists for user ${userId} but its id was not returned; cannot reuse.`,
          { cause: err },
        );
      }
      throw err;
    }
  }

  /** Issue a single-use card and place the authorization hold. Guards cents BEFORE any call. */
  async issueCard(userId: string, amountCents: number, merchantId: string): Promise<CardRef> {
    assertCents(amountCents);
    const { cardholderId } = await this.ensureCardholder(userId);
    const res = await this.client.createCard({ amountCents, cardholderId });
    return toCardRef(res, { cardholderId, merchantId, amountCents });
  }

  /** TRUSTED-side only. Returns `{ pan, cvv, expiry }`. Never logged, never to the LLM. */
  async getCardSecret(cardRef: CardRef): Promise<PAN_CVV_EXP> {
    const details = await this.client.cardDetails(cardRef.cardId);
    return { pan: details.pan, cvv: details.cvv, expiry: details.expiry };
  }

  /** Release the hold (idempotent). A 404 means already closed — treat as success. */
  async closeCard(cardRef: CardRef): Promise<void> {
    try {
      await this.client.closeCard(cardRef.cardId);
    } catch (err) {
      if (err instanceof AgentcardError && err.meta.status === 404) return;
      throw err;
    }
  }

  /** Reconciliation read — projects the webhook event store into Txn rows. */
  async listTransactions(cardRef: CardRef): Promise<Txn[]> {
    return this.eventStore
      .byCard(cardRef.cardId)
      .map(toTxn)
      .filter((t): t is Txn => t !== null);
  }

  /** Settlement/decline/reversal sink — append to the event store. */
  onWebhook(event: ChargeEvent): void {
    this.eventStore.append(event);
  }
}

function assertCents(amountCents: number): void {
  if (!Number.isInteger(amountCents)) {
    throw new FundingError(`amountCents must be an integer number of cents, got ${amountCents}.`);
  }
  if (amountCents < MIN_CARD_CENTS) {
    throw new FundingError(`amountCents ${amountCents} is below the $1.00 minimum (${MIN_CARD_CENTS}).`);
  }
  if (amountCents > MAX_CARD_CENTS) {
    throw new FundingError(
      `amountCents ${amountCents} exceeds the per-card ceiling of ${MAX_CARD_CENTS} ($50.00).`,
    );
  }
}

function mapCardStatus(status: CardResponse['status']): CardStatus {
  return status === 'CLOSED' ? 'closed' : 'active';
}

function toCardRef(
  res: CardResponse,
  ctx: { cardholderId: string; merchantId: string; amountCents: number },
): CardRef {
  return {
    cardId: res.id,
    cardholderId: ctx.cardholderId,
    merchantId: ctx.merchantId,
    amountCents: ctx.amountCents,
    status: mapCardStatus(res.status),
  };
}

const TXN_STATUS_BY_EVENT: Record<string, TxnStatus> = {
  'transaction.authorized': 'authorized',
  'transaction.cleared': 'cleared',
  'transaction.declined': 'declined',
  'transaction.voided': 'voided',
};

/** Project a ChargeEvent to a Txn row, or null for non-transaction events. */
function toTxn(event: ChargeEvent): Txn | null {
  const status = TXN_STATUS_BY_EVENT[event.type];
  if (!status) return null;
  if (!event.txId || event.amountCents === undefined) return null;
  return {
    txId: event.txId,
    cardId: event.cardId,
    amountCents: event.amountCents,
    status,
    occurredAt: event.occurredAt,
  };
}

function extractCardholderId(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const id = (body as Record<string, unknown>).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return undefined;
}
