/**
 * Production composition: construct the REAL Wave-2 collaborators (Agentcard rail,
 * Vault B, headless-Chrome Executor) and assemble the orchestrator `CheckoutDeps`
 * + the shared webhook event store. This is integration glue exercised by the live
 * run, not by unit tests (the testable mapping lives in `checkout-deps.ts`).
 *
 * NOTE (live-run gap, documented in the phase report): `Executor.checkout` assumes
 * the driver is already on the merchant checkout FORM — building the guest cart by
 * navigating an arbitrary live merchant is a follow-up. For the slice/integration
 * test a mock checkout form stands in.
 */
/* v8 ignore start */
import {
  AgentcardClient,
  AgentcardRail,
  WebhookEventStore,
  type CardholderProfile,
} from '@tomo/funding';
import { VaultB, InMemoryStore, selectStore } from '@tomo/vaults';
import { Executor, PlaywrightDriver, type BrowserDriver } from '@tomo/executor';
import type { CardRef, PAN_CVV_EXP } from '@tomo/core';
import { assembleCheckoutDeps } from './checkout-deps.js';
import type { ApiConfig } from './config.js';
import type { CheckoutDeps } from '@tomo/orchestrator';

export interface CompositionEnv {
  readonly config: ApiConfig;
  /** Override the browser driver (defaults to headless-Chrome PlaywrightDriver). */
  readonly driver?: BrowserDriver;
  /** Resolve the Agentcard cardholder profile for a user (trusted side). */
  readonly resolveCardholder?: (userId: string) => Promise<CardholderProfile> | CardholderProfile;
  /** Selector the executor reads the confirmation id from after submit. */
  readonly confirmationSelector?: string;
}

export interface Composition {
  readonly deps: CheckoutDeps;
  readonly eventStore: WebhookEventStore;
  readonly accountClaimQueue: string[];
}

/** A conservative default cardholder profile (replace with a Vault-B-backed resolver in prod). */
function defaultCardholder(userId: string): CardholderProfile {
  return {
    firstName: 'Tomo',
    lastName: userId,
    dateOfBirth: '1990-01-01',
    phoneNumber: '+15555550000',
    email: `${userId}@tomo.example`,
  };
}

export function buildCheckoutDeps(env: CompositionEnv): Composition {
  const eventStore = new WebhookEventStore();
  const client = new AgentcardClient({
    apiKey: env.config.agentcardApiKey,
    ...(env.config.agentcardBaseUrl ? { baseUrl: env.config.agentcardBaseUrl } : {}),
  });
  const rail = new AgentcardRail({
    client,
    resolveProfile: env.resolveCardholder ?? defaultCardholder,
    eventStore,
  });

  // Vault B (real, field-level, audited). Store selection follows the vault package env.
  const store = (() => {
    try {
      return selectStore();
    } catch {
      return new InMemoryStore();
    }
  })();
  const vaultB = new VaultB(store, env.config.vaultMasterKey);

  const driver = env.driver ?? new PlaywrightDriver(true);
  const getCardSecret = (cardRef: CardRef): Promise<PAN_CVV_EXP> => rail.getCardSecret(cardRef);
  const executor = new Executor({ driver, vaultB, getCardSecret });

  const accountClaimQueue: string[] = [];
  const deps = assembleCheckoutDeps({
    rail,
    events: eventStore,
    executor,
    accountClaimQueue,
    ...(env.confirmationSelector ? { confirmationSelector: env.confirmationSelector } : {}),
  });

  return { deps, eventStore, accountClaimQueue };
}
/* v8 ignore stop */
