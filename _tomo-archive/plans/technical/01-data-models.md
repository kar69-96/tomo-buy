# Data Models

> These are the **frozen contracts** created in `packages/core` by phase-00. Every other package
> imports them and never redefines them. All are validated with **Zod** at system boundaries.

## 1. MerchantProfile (§3.1) — static config, one row per merchant

```ts
interface MerchantProfile {
  merchant_id: string;
  lane: "A" | "B";              // "A" = Agentcard partner, "B" = self-driven
  terminal_rail: boolean;       // sanctioned machine rail (agent API / x402 / delegated-pay)?
  sso_grant: boolean;           // consumer SSO/OAuth returning a scoped revocable token?
  guest_checkout: boolean;      // can complete with no account at all?
  account_required: boolean;    // account mandatory to transact?
  automation_hostility: "low" | "med" | "high";  // derived — see §4 below
  forces_3ds: boolean;          // payment step forces 3DS/step-up? (Lane B gating)
  phone_required: boolean;      // signup/checkout gates on SMS OTP?
  profile_version: number;
  last_verified_at: string;     // ISO 8601
}
```

`lane`, `terminal_rail`, `sso_grant`, etc. are **re-derived on each run** — the router reads the
current profile, so a merchant that ships SSO graduates automatically (self-upgrading, see `04-router-cascade.md`).

## 2. TaskIntent (§3.2) — parsed per request by the LLM, then validated

```ts
interface TaskIntent {
  merchant_id: string;
  cart_spec: {
    natural: string;            // "sushi under $40 from my usual place"
    items?: CartItem[];
  };
  price_ceiling_cents: number;  // hard ceiling; conservative default if user gave none
  account_bound: boolean;       // references something only the user's own account holds
  ship_to_ref: string;          // e.g. "vaultB:user_123:home_address" — a REFERENCE, never a value
}
```

`account_bound = true` for any reference to the user's own held entity: "my usual", "use my
credit/points", "reorder last week's", "modify my reservation", "my saved address/cart".

**The TaskIntent carries references, never secrets.** `ship_to_ref` is a pointer the Executor
resolves against Vault B — the actual address never appears in the intent or in LLM context.

## 3. Vault discipline (§3.3) — two stores, never readable by the LLM

| | **Vault A — agent secrets** | **Vault B — user PII** |
|---|---|---|
| Contents | Generated high-entropy passwords / credentials the agent mints | Name, address, email-of-record, phone |
| Scope | per `(user, merchant)` | per user |
| Why split | Leak = one agent-made account, revocable, worthless elsewhere | Real identity data isn't revocable — stricter store |
| Access | Written once, read only by Executor at login | **Field-level release** — Executor requests one field at fill time |
| Controls | encryption at rest | per-field access log, data minimization, encryption at rest, deletion path |

Trust boundary (both vaults + card/wallet secrets): the model emits *intent only*; the trusted-side
Executor is the only thing that opens a vault, injects the value, and returns **nothing but a
success flag**.

```ts
interface VaultA { read(user: string, merchant: string): Promise<AgentCredential>; /* Executor-only */ }
interface VaultB {
  releaseField(user: string, field: PiiField): Promise<string>;  // logged, Executor-only
  // no bulk read into model context — ever
}
type PiiField = "name" | "street" | "city" | "state" | "zip" | "country" | "email" | "phone";
```

## 4. automation_hostility (§3.4) — replaces the dead `fresh_account_risk`

The original plan defined `fresh_account_risk` but **no router branch ever read it** — dead config.
It's replaced by a single derived score, because CAPTCHA-likelihood, VoIP/phone-gating, and
fresh-signup-flagging are the *same merchant fraud stack wearing three hats*:

```
automation_hostility = f(fresh_account_flagging, captcha_frequency, phone_required, device_fingerprinting)
  → "low" | "med" | "high"
```

It **gates whether autonomous P3 is even attempted** (router Step 3): `high` → prefer P1, else
`P3_ASSISTED` (human-relayed OTP/CAPTCHA), else `EXPLAIN_CANT`.

## 5. P0 vendor catalog (§3.5) — self-maintained, source of `terminal_rail`

No third-party issuer. We maintain our own catalog; **presence in it (live endpoint + protocol) is
what makes `terminal_rail == true`** for that vendor.

```ts
interface P0Vendor {
  vendor_id: string;
  name: string;
  category: string;
  protocol: "x402" | "mpp";
  endpoint: string;
  order_schema: object;                       // structured order shape for this vendor
  pricing: { unit: string; amount_cents: number; currency: string };
  settlement: { chain: string; asset: string };  // x402 specifics
  last_verified_at: string;
  catalog_version: number;
}
```

Population: onboard one at a time, or auto-discover from x402-advertising 402 responses. Verify on a
schedule; stale entries fall out of P0. (P0 wiring is a **deferred** phase; the catalog type is frozen now.)

## 6. RoutingDecision + terminals

```ts
type Path = "AGENTCARD_BUY" | "P0" | "P1" | "P2" | "P3" | "P3_ASSISTED";
interface RoutingDecision {
  path: Path | "EXPLAIN_CANT";
  merchant_id: string;
  reasons: string[];
  explain_cant?: { reason: string; offer?: string; disclose_whats_lost?: boolean };
}
```

## 7. Zod guidance

- Every boundary (intent output, webhook payloads, API request bodies, profile/catalog loads)
  validates against a Zod schema before use. Fail fast with a clear message.
- `core` exports both the TS `interface` and the matching `z.object(...)`; derive the type with
  `z.infer` so they never drift.
- Money is **cents** everywhere (`amountCents`, `price_ceiling_cents`). Never a float dollar amount.
