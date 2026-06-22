# Funding Rail Abstraction

> Even though Agentcard is the chosen provider, wrap it so the provider is swappable and the rest of
> the system depends on an **interface**, not on Agentcard specifics.

## 1. FundingRail (§4) — the card rail interface

```ts
interface FundingRail {
  ensureCardholder(userId: string): Promise<CardholderRef>;
  // returns a single-use card; places an authorization hold for amountCents
  issueCard(userId: string, amountCents: number, merchantId: string): Promise<CardRef>;
  getCardSecret(cardRef: CardRef): Promise<PAN_CVV_EXP>;   // TRUSTED-side only
  closeCard(cardRef: CardRef): Promise<void>;              // release hold on abandon (§8)
  listTransactions(cardRef: CardRef): Promise<Txn[]>;      // reconciliation (§8)
  onWebhook(event: ChargeEvent): void;                     // settlement/decline/reversal
}
```

### Critical secret-flow rule
`getCardSecret` output (`{ pan, cvv, expiry }`) flows **only** into the Executor's page-fill path.
It is **never** returned to the LLM, never logged, never placed in a TaskIntent. It is fetched
trusted-side immediately before injection and discarded after.

### Implementations
```ts
class AgentcardRail implements FundingRail { /* documented endpoints — see 03-agentcard-client.md */ }
class BuyToolRail   implements FundingRail { /* Lane A /buy — STUB in this build (EXPLAIN_CANT) */ }
```

## 2. AgentcardRail — mapping to documented endpoints

| Interface method | Documented call(s) |
|---|---|
| `ensureCardholder` | `POST /api/v1/cardholders` (create if absent); attach via `POST /api/v1/cardholders/{id}/payment-method/setup` (one-time, Stripe checkout) |
| `issueCard` | `POST /api/v1/cards` `{ amountCents, cardholderId }` → places the hold |
| `getCardSecret` | `GET /api/v1/cards/{id}/details` → `{ pan, cvv, expiry }` (audit-logged) |
| `closeCard` | `DELETE /api/v1/cards/{id}` (idempotent; **releases the hold**) |
| `listTransactions` | **No documented list endpoint** → adapter reads the local **webhook event store** (see below) |
| `onWebhook` | `transaction.authorized / cleared / declined / voided`, `card.*`, `balance.low` |

### Cents + limit guards
- All amounts are **cents**. Reject any `amountCents > 5000` at the rail boundary (org default
  per-card cap is **$50**; raising it requires Agentcard support — see open decisions).
- A single-use card can't be split. If `cart_total > card limit` → reject or escalate plan; never
  silently truncate.

### listTransactions via webhook event store
There is no documented "list transactions" endpoint. The rail keeps a **webhook event store**
(append-only, keyed by card id) populated by `onWebhook`. `listTransactions(cardRef)` reads from it.
This store is the **reconciliation source of truth** for the §8 state machine — see
`06-approval-recon-sm.md`. (`listTransactions` stays a TO-CONFIRM adapter: if Agentcard later
documents a list endpoint, swap the implementation without changing the interface.)

## 3. MachineRail (P0) — separate, DEFERRED

P0 does **not** use Agentcard or any third-party issuer. It settles directly over a protocol against
a vendor in the self-maintained P0 catalog (§3.5).

```ts
interface MachineRail {
  pay(catalogVendorId: string, amountCents: number, order: OrderSpec): Promise<Settlement>;
  setControls(c: { dailyCents?: number; perTxCents?: number; allowedVendors?: string[] }): Promise<void>;
}
class X402Rail implements MachineRail { /* Coinbase x402: stablecoin-native HTTP 402 settlement */ }
class MPPRail  implements MachineRail { /* Machine Payments Protocol settlement */ }
```

- **Settlement wallet:** dropping any third-party rail means *we* hold the x402 settlement wallet
  (a self-custodied stablecoin treasury wallet, or one backed by a wallet provider). Its keys are
  **server-side only, never in model context** — the model emits a pay-intent handle, the trusted
  side settles.
- **Spending controls** (`setControls`) on the wallet (per-day, per-tx, allowed-vendor allowlist)
  mirror the Executor guardrails (§12).
- **Status:** `rails-x402` ports the AgentPay x402 client now (phase-01 owns the dir), but Step-2
  routing + the catalog + the wallet are wired in a **deferred** phase. The settlement/custody choice
  is an open decision (`../spec/02-open-decisions.md`). P0 is **card-path-independent** — it never
  touches Agentcard.

## 4. Swappability

The rest of the system imports `FundingRail` / `MachineRail`, never a concrete class. Pluggable card
issuers (Stripe Issuing, Crossmint, Lithic, Privacy.com) can implement `FundingRail` behind the same
interface if Agentcard is ever swapped.
