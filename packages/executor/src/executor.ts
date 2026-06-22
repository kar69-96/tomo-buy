import type {
  TaskIntent,
  RoutingDecision,
  CardRef,
  PAN_CVV_EXP,
  PiiField,
  VaultA,
} from '@tomo/core';
import { ExecutorError } from '@tomo/core';

/**
 * Vault B as the Executor consumes it: field-level release with an optional
 * requester for audit context. The core `VaultB` (2-arg releaseField) is
 * assignable here — a fewer-parameter function satisfies a more-parameter type —
 * so any core-conformant Vault B (incl. @tomo/vaults) plugs in unchanged.
 */
export interface ReleasingVaultB {
  releaseField(user: string, field: PiiField, requester?: string): Promise<string>;
}
import type { BrowserDriver } from './browser/driver.js';
import { PLACEHOLDER_MAP, getPlaceholderVariables, getAtomicSwapScript } from './placeholder.js';
import {
  assertAmountWithinCeiling,
  assertMerchantMatches,
  assertShipToFromVault,
  surfaceInstructions,
  type Address,
} from './guardrails.js';

/** Just-in-time card-secret fetcher (the FundingRail.getCardSecret shape). */
export type GetCardSecret = (cardRef: CardRef) => Promise<PAN_CVV_EXP>;

/** Result of a checkout. FLAGS + non-sensitive status ONLY — never a secret. */
export interface ExecutorResult {
  readonly success: boolean;
  readonly confirmationId?: string;
  readonly reason?: string;
  /** Instruction-like page text surfaced to the user — never acted on. */
  readonly surfaced: readonly string[];
}

export interface ExecutorDeps {
  readonly driver: BrowserDriver;
  readonly vaultB: ReleasingVaultB;
  readonly getCardSecret: GetCardSecret;
  readonly vaultA?: VaultA;
  /** Agent-visible transcript sink. Receives placeholder markers only. */
  readonly transcript?: string[];
  /** Server-side log sink. Receives non-secret status only. */
  readonly logger?: (message: string) => void;
}

export interface CheckoutParams {
  readonly user: string;
  readonly intent: TaskIntent;
  readonly routing: RoutingDecision;
  readonly cardRef: CardRef;
  /** The amount the page proposes to charge (re-validated against the ceiling). */
  readonly amountCents: number;
  /** The merchant the page represents (re-validated against the routed merchant). */
  readonly pageMerchantId: string;
  /** Optional selector to read a confirmation id from after submit. */
  readonly confirmationSelector?: string;
}

/**
 * Field name (form `name` attr / PLACEHOLDER_MAP key) → where the real value
 * comes from. Card fields come from getCardSecret; everything else is a single
 * Vault B field. This table is the ONLY place a placeholder maps to a secret
 * source, and it runs entirely trusted-side.
 */
type CardPart = { kind: 'card'; part: keyof PAN_CVV_EXP };
type PiiPart = { kind: 'pii'; field: PiiField };
type Source = CardPart | PiiPart;

const FIELD_SOURCES: Record<string, Source> = {
  card_number: { kind: 'card', part: 'pan' },
  card_cvv: { kind: 'card', part: 'cvv' },
  card_expiry: { kind: 'card', part: 'expiry' },
  cardholder_name: { kind: 'pii', field: 'name' },
  email: { kind: 'pii', field: 'email' },
  phone: { kind: 'pii', field: 'phone' },
  shipping_street: { kind: 'pii', field: 'street' },
  shipping_city: { kind: 'pii', field: 'city' },
  shipping_state: { kind: 'pii', field: 'state' },
  shipping_zip: { kind: 'pii', field: 'zip' },
  shipping_country: { kind: 'pii', field: 'country' },
  billing_street: { kind: 'pii', field: 'street' },
  billing_city: { kind: 'pii', field: 'city' },
  billing_state: { kind: 'pii', field: 'state' },
  billing_zip: { kind: 'pii', field: 'zip' },
  billing_country: { kind: 'pii', field: 'country' },
};

/**
 * The trusted-side Executor. It is the ONLY component that opens a secret and
 * injects it into a page. The LLM/agent sees only `%var%` placeholders (recorded
 * in the transcript); real values are assembled here, handed to the in-page
 * atomic swap, and never returned, logged, or placed in the transcript.
 */
export class Executor {
  private readonly transcript: string[];
  private readonly log: (message: string) => void;

  constructor(private readonly deps: ExecutorDeps) {
    this.transcript = deps.transcript ?? [];
    this.log = deps.logger ?? (() => {});
  }

  async checkout(params: CheckoutParams): Promise<ExecutorResult> {
    const { user, intent, routing, cardRef, amountCents, pageMerchantId } = params;

    // --- §12 guardrails on TRUSTED state, before any side effect ---
    assertAmountWithinCeiling(amountCents, intent.price_ceiling_cents);
    assertMerchantMatches(routing.merchant_id, pageMerchantId);
    assertMerchantMatches(routing.merchant_id, intent.merchant_id);

    // --- Discover + fill placeholders (agent-visible: %var% only) ---
    const fields = await this.deps.driver.discoverFields();
    const agentVars = getPlaceholderVariables();
    const fillable = fields.filter((f) => FIELD_SOURCES[f.name] !== undefined);

    for (const field of fillable) {
      const marker = PLACEHOLDER_MAP[field.name as keyof typeof PLACEHOLDER_MAP];
      await this.deps.driver.fillField(field.selector, marker);
      this.transcript.push(`fill ${field.selector} := ${agentVars[field.name]}`);
      this.log(`executor: filled '${field.name}' with placeholder`);
    }

    // --- Assemble the real swap map trusted-side (NEVER logged/transcribed) ---
    let cardSecret: PAN_CVV_EXP | undefined;
    const swapMap: Record<string, string> = {};
    const shipTo: Address = {};

    for (const field of fillable) {
      const source = FIELD_SOURCES[field.name]!;
      const marker = PLACEHOLDER_MAP[field.name as keyof typeof PLACEHOLDER_MAP];
      let value: string;
      if (source.kind === 'card') {
        cardSecret ??= await this.deps.getCardSecret(cardRef);
        value = cardSecret[source.part];
      } else {
        value = await this.deps.vaultB.releaseField(user, source.field, 'executor:checkout');
        if (field.name.startsWith('shipping_') || field.name === 'cardholder_name') {
          this.assignShipTo(shipTo, field.name, value);
        }
      }
      swapMap[marker] = value;
    }

    // Rule 2: the shipping address we assembled came ONLY from Vault B. Re-read it
    // independently and assert equality — a page-injected address could never
    // appear here, and this wiring proves the address is vault-sourced.
    await this.assertShipToVaultSourced(user, shipTo);

    // --- Page text is DATA: surface instruction-like content, never act on it ---
    const surfaced = surfaceInstructions(await this.deps.driver.getPageText());
    if (surfaced.length > 0) {
      this.log(`executor: surfaced ${surfaced.length} instruction-like snippet(s) to user`);
    }

    // --- Atomic swap (real values in the DOM for milliseconds) + submit ---
    await this.deps.driver.evaluateSwap(getAtomicSwapScript(), swapMap);

    // --- Confirmation read (non-secret) ---
    let confirmationId: string | undefined;
    if (params.confirmationSelector) {
      confirmationId = (await this.deps.driver.readValue(params.confirmationSelector)) || undefined;
    }

    this.log('executor: checkout submitted');
    return { success: true, confirmationId, surfaced };
  }

  private assignShipTo(shipTo: Address, fieldName: string, value: string): void {
    if (fieldName === 'cardholder_name') shipTo.name = value;
    else if (fieldName === 'shipping_street') shipTo.street = value;
    else if (fieldName === 'shipping_city') shipTo.city = value;
    else if (fieldName === 'shipping_state') shipTo.state = value;
    else if (fieldName === 'shipping_zip') shipTo.zip = value;
    else if (fieldName === 'shipping_country') shipTo.country = value;
  }

  private async assertShipToVaultSourced(user: string, used: Address): Promise<void> {
    const vaultAddress: Address = {};
    const map: [keyof Address, PiiField][] = [
      ['name', 'name'],
      ['street', 'street'],
      ['city', 'city'],
      ['state', 'state'],
      ['zip', 'zip'],
      ['country', 'country'],
    ];
    for (const [addrKey, piiField] of map) {
      if (used[addrKey] !== undefined) {
        try {
          vaultAddress[addrKey] = await this.deps.vaultB.releaseField(
            user,
            piiField,
            'executor:guardrail',
          );
        } catch (cause) {
          throw new ExecutorError(`ship_to '${addrKey}' is not present in Vault B.`, { cause });
        }
      }
    }
    assertShipToFromVault(used, vaultAddress);
  }
}
