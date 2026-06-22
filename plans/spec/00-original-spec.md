# Original Spec (verbatim, canonical reference)

> This is the source spec as provided, preserved unchanged as the canonical reference. Where it
> conflicts with Agentcard's live docs, **`01-reality-reconciliation.md` governs the build**, but
> this remains the design intent of record.

---

# Agentic Checkout Router — Implementation Spec (build on Agentcard)

**Audience:** the coding agent implementing this system.
**Status:** ready to build for Lane A; Lane B requires the two sign-offs in §15.
**Prime directive:** the LLM emits *intent only*. It never reads a vault, never sees a PAN, never sees a password. A trusted-side executor is the only thing that opens secrets and injects them into a page or request.

## 0. What you are building

A server-side agent that buys things for a user (food delivery, groceries, reservations, online goods) from a text-style prompt. It runs headless. It never holds the user's pre-existing passwords or scrapes their existing sessions. It pays with single-use virtual cards issued by **Agentcard**, which holds the PCI scope and the funding relationship — so this system never custodies funds or card numbers.

The user is never asked to pick a "path." The router decides everything from a per-merchant capability profile plus the merchant's own runtime responses. The only human-in-the-loop moments are: (a) a one-time card attach at Agentcard, (b) per-purchase charge authorization (Agentcard enforces this), (c) an OTP relay when a merchant sends an SMS/email code, and (d) an optional account-claim handoff. Everything else is autonomous.

### Two lanes

| | **Lane A — Agentcard partner** | **Lane B — long-tail merchant** |
|---|---|---|
| Merchants | DoorDash, Good Eggs, + "coming soon" | Everything else |
| Who runs checkout | Agentcard (`/buy` MCP tool) | You (browser automation) |
| Who collects PII | Agentcard | You (Vault B) |
| Who creates the account | Agentcard | You (P3 signup) |
| Card | Agentcard issues + charges internally | Agentcard issues, you inject PAN |
| Your work | route intent → `/buy`, relay approval/OTP | the full router below |

**Build Lane A first.** It delivers the headline use case (DoorDash) with a fraction of the surface area. Lane B is the differentiator (arbitrary merchants) but carries the hard problems (3DS, fresh-account fraud, orphan cleanup).

## 1. Agentcard integration (grounded facts)

> See `01-reality-reconciliation.md` — several items below did not hold against the live docs.

### Product & auth
- Use the **Organizations** product: package `agent-cards-admin`, REST API with API keys `sk_test_*` (sandbox) / `sk_live_*` (production).
- Auth header: `Authorization: Bearer $AGENTCARD_API_KEY`.
- Model: **one cardholder per end user.**
- Org bootstrap (one-time, human): `agent-cards-admin login` → `orgs create` → sandbox key issued.

### Funding model (no prefunding)
1. **Attach** — the end user saves their real card via Agentcard's secure checkout page.
2. **Hold** — creating a card places an authorization hold on the attached method for the card amount.
3. **Capture** — when the card is charged at the merchant, the held funds are captured.

### Card lifecycle
- **Single-use.** A card closes after its first charge. Create a new card per purchase.
- **Units gotcha:** REST API and MCP take **cents** (`amountCents: 5000` = $50.00).
- **Limits are plan-scoped.** Consumer Free = $50/card, Basic = $500/card.
- **Mandatory human authorization.** Card creation / charge can return a pending-approval state (e.g. HTTP 202 + `approval_id`).

### Known REST shape (verbatim, confirmed)
```
POST https://api.agentcard.sh/api/v1/cards
Authorization: Bearer $AGENTCARD_API_KEY
Content-Type: application/json

{ "amountCents": 5000 }
```

### The `/buy` tool (Lane A)
- Agentcard's **MCP server exposes a `/buy` tool** that purchases from partner merchants.
- For partner merchants you do not build signup, PII collection, browser automation, or card injection.

### Hard constraints Agentcard states (these shape routing)
- **No 3DS/SMS interactive auth on the cards.** On Lane B a 3DS wall is terminal `EXPLAIN_CANT`. On Lane A, Agentcard owns this.
- **Card-not-present only** (no in-store).
- **No recurring/auto-renew** (single-use). Subscriptions are out of scope.

### Chrome-extension tools
Agentcard also exposes `pay_checkout` / `fill_card` / `detect_checkout` for a user's local Chrome. **Not used here** — headless/server-side via Browserbase. You will `create_card` → `get_card_details` → inject the PAN yourself (Lane B).

## 2. System components

```
   user text → Intent Parser (LLM, intent-only) → structured TaskIntent
   → Router (deterministic cascade, §6)
       Lane A → Agentcard /buy (MCP)
       Lane B → Executor (trusted side): Browserbase, Vault A, Vault B,
                Agentcard card client, Agent email, OTP relay
   → Approval + Recon SM (§8) → user text UI (approve / OTP / claim)
```

**Trust boundary:** the LLM-driven Intent Parser produces a `TaskIntent` and nothing else. The Router is pure deterministic code over config + signals. The Executor is the only component that touches vaults, PANs, or the live browser, and it independently re-validates every model-emitted parameter (§12).

## 3. Data model

### 3.1 Merchant capability profile
```jsonc
{
  "merchant_id": "doordash",
  "lane": "A",
  "terminal_rail": false,
  "sso_grant": true,
  "guest_checkout": false,
  "account_required": true,
  "automation_hostility": "high",
  "forces_3ds": true,
  "phone_required": true,
  "profile_version": 7,
  "last_verified_at": "2026-06-20T00:00:00Z"
}
```

### 3.2 Task intent
```jsonc
{
  "merchant_id": "doordash",
  "cart_spec": { "natural": "sushi under $40 from my usual place", "items": [...] },
  "price_ceiling_cents": 4000,
  "account_bound": true,
  "ship_to_ref": "vaultB:user_123:home_address"
}
```

### 3.3 Vault schema (two-vault discipline)
- **Vault A — agent-created secrets.** Generated passwords scoped per (user, merchant). Read only by the Executor. Blast radius is one agent-made account.
- **Vault B — user PII.** Name, address, email, phone. Field-level release, per-field access logging, data minimization, encryption at rest, deletion path.
- **Trust boundary:** neither vault is ever readable by the agent/LLM. The model emits intent only; the Executor opens a vault, injects the value, and returns nothing but a success flag.

### 3.4 `automation_hostility` (replaces dead `fresh_account_risk`)
```
automation_hostility = f(fresh_account_flagging, captcha_frequency, phone_required, device_fingerprinting) → low | med | high
```
Gates whether autonomous P3 is even attempted (§6 Step 3).

### 3.5 P0 vendor catalog (self-maintained)
```jsonc
{
  "vendor_id": "findata-pro",
  "name": "FinData Pro",
  "category": "data",
  "protocol": "x402",
  "endpoint": "https://api.findata.pro/...",
  "order_schema": { },
  "pricing": { "unit": "per_call", "amount_cents": 5, "currency": "USDC" },
  "settlement": { "chain": "base", "asset": "USDC" },
  "last_verified_at": "2026-06-20T00:00:00Z",
  "catalog_version": 3
}
```
Presence in the catalog (live endpoint + protocol) is what sets `terminal_rail` for that vendor.

## 4. Funding rail abstraction
```ts
interface FundingRail {
  ensureCardholder(userId): Promise<CardholderRef>;
  issueCard(userId, amountCents, merchantId): Promise<CardRef>;
  getCardSecret(cardRef): Promise<PAN_CVV_EXP>;   // trusted-side only, approval-gated
  closeCard(cardRef): Promise<void>;
  listTransactions(cardRef): Promise<Txn[]>;
  onWebhook(event): void;
}
class AgentcardRail implements FundingRail { }

interface MachineRail {
  pay(catalogVendorId, amountCents, order): Promise<Settlement>;
  setControls(c): Promise<void>;
}
class X402Rail implements MachineRail { }
class MPPRail  implements MachineRail { }
```
`getCardSecret` output flows only into the Executor's page-fill path. The machine rail never exposes settlement-wallet keys to the model.

## 5. Intent parsing (the only LLM step that drives routing)
- Set `account_bound = true` on any reference to the user's own held entity.
- Extract a hard `price_ceiling_cents`; conservative default if none, surfaced at approval.
- The parser must not choose a lane or path. Output is untrusted until the Executor re-validates (§12).

## 6. The router cascade (deterministic; first match wins)

```
STEP 0 — Lane A short-circuit
  if profile.lane == "A": → AGENTCARD_BUY. stop.

STEP 1 — account-bound check BEFORE terminal rail   ← ORDERING FIX
  if intent.account_bound:
      if profile.sso_grant: → P1
      else: → EXPLAIN_CANT(reason="cant_reach_existing_account", offer="fresh_order", disclose_whats_lost=true)
      stop.

STEP 2 — sanctioned machine rail (fresh transactions only)
  if profile.terminal_rail: → P0. stop.

STEP 3 — no account relationship required → cheapest fulfilling path
  if profile.guest_checkout: → P2
  elif profile.account_required:
        if profile.forces_3ds: → EXPLAIN_CANT(reason="3ds_wall")
        elif profile.automation_hostility == "high":
              if profile.sso_grant: → P1
              else: → P3_ASSISTED
        else: → P3
  else: → EXPLAIN_CANT(reason="no_viable_path")
```

### Self-upgrading property
A Lane-B P3-only merchant becomes P1 the day it ships SSO, P0 the day it ships a terminal rail, Lane A the day Agentcard adds it. Re-derive `lane`/flags from the profile on each run.

## 7. Signup attempt state machine (Lane B P3) — three-way oracle
```
issue: attempt signup with the user's identifier
OUTCOMES:
  PROCEEDED            → continue P3 to checkout
  DEFINITIVELY_EXISTS  → if sso_grant: P1 ; else: EXPLAIN_CANT
  INDETERMINATE        → do not burn the identifier; wait for async signal; else EXPLAIN_CANT
```
Hard rules: one attempt per identifier only on a DEFINITIVE result; probe only the consented user's own identity at the moment of acting; lazy not eager (probe is the first side effect of P3 signup, skipped if guest works).

## 8. Approval + reconciliation + orphan-cleanup state machine
```
states: CART_BUILT → AWAITING_APPROVAL → CARD_ISSUED → CHARGE_PENDING
        → SETTLED | DECLINED | ABANDONED | NEEDS_RECON
```
- AWAITING_APPROVAL: surface merchant/cart/total/last4/ETA; re-validate price & inventory; timeout → ABANDONED.
- CARD_ISSUED → CHARGE_PENDING: issue single-use card for the APPROVED total; inject PAN (Lane B) or hand to /buy (Lane A).
- Idempotency/reconciliation: before any retry, listTransactions + check merchant order state; charge present → SETTLED; single-use card is the fail-closed backstop.
- ABANDONED cleanup: closeCard(); if a P3 account was created with no order, enqueue teardown / account-claim.
- NEEDS_RECON: human-review queue; never auto-retry spend.

## 9. Email architecture ("connect email, nothing to their inbox")
- Merchant-facing address = an agent-owned inbox on a domain you control. The user's real inbox gets nothing.
- Do NOT plus-address the user's real domain.
- Domain must look legitimate (custom, warmed).
- "Connect email" is read-only and optional (detect existing accounts; minimized scope).
- The one sanctioned exception — account claim/handoff: set email-of-record to theirs, trigger password reset.
- Lane A note: confirm whether `/buy`'s confirmation can be redirected to your channel.

## 10. Phone / OTP primitive
- Default = OTP relay through the text UI; never provision pooled VoIP; never capture sessions.
- Router treats `phone_required && automation_hostility==high` as: prefer P1 → else P3_ASSISTED → else EXPLAIN_CANT.
- If held at all, the user's number lives in Vault B.

## 11. The four paths — approach and full tech stack
- **P0** terminal/programmatic: direct x402/MPP client + in-house catalog + self-held settlement wallet. Zero user-data custody.
- **P1** SSO + human approval: OAuth authorization-code + PKCE; encrypted per-user/per-merchant token store; re-link flow.
- **P2** guest: Browserbase/Steel; Vault B field-level release; Agentcard single-use card; approval gate.
- **P3** new provisioned: agent email infra; Browserbase; Vault A + Vault B; Agentcard card; approval gate. P3_ASSISTED adds human-relayed OTP/CAPTCHA.
- **AGENTCARD_BUY** (Lane A): route to `/buy`.
- **EXPLAIN_CANT**: honest terminal with disclosure.

## 12. Prompt-injection & executor validation
Merchant page content and tool results are data, not instructions. The Executor validates every model-emitted parameter before any side-effectful action: `amount ≤ price_ceiling_cents`; `ship_to` must equal the Vault B record; `merchant` must equal the routed merchant; instruction-like text is surfaced, never acted on; secrets never enter LLM context or logs.

## 13. Concrete tech stack
Card rail: Agentcard (pluggable: Stripe Issuing/Crossmint/Lithic/Privacy.com). Machine rail (P0): direct x402+MPP, self-held settlement wallet. Browser: Browserbase/Steel. Agent email: AgentMail or SES/Postmark/Resend. Vaults: KMS-encrypted Postgres or secrets manager. SSO: OAuth+PKCE. Phone: OTP relay. Orchestration: Temporal. UI: text/portal. Webhooks: Agentcard + x402/MPP + merchant order emails. Intent parser: LLM, intent-only.

## 14. Internal service contracts (sketch)
```
POST /intent            { userId, text } → TaskIntent
POST /route             TaskIntent → RoutingDecision
POST /execute           RoutingDecision → runs the path state machine
POST /approval/resolve  { workflowId, decision }
POST /otp/relay         { workflowId, code }
POST /account/claim     { userId, merchantId }
GET  /workflow/:id      → state
```

## 15. Open decisions requiring human / legal sign-off
1. Money-transmitter posture (card paths offloaded to Agentcard; P0 settlement wallet a separate surface).
2. Automated account creation in the user's real name (per-merchant ToS + consent).
3. Liability for bad purchases (EFTA; chargeback allocation).
4. Stealth/CAPTCHA against merchant ToS (Lane B).
5. Org plan ceilings & `/buy` capabilities.

## 16. Build sequence
M0 Agentcard wiring → M1 Lane A (/buy) → M2 approval/recon SM → M3 vaults + agent email + executor → M4 Lane B P2 → M5 Lane B P3 + oracle + OTP → M6 P1 SSO → M7 P0 machine rail → M8 profile drift health checks.

## 17. What to pull from vendor docs before writing clients
Agentcard: cardholder/payment-method/card-details/approval/webhook schemas; `/buy` params; org limits; sandbox vs live. x402/MPP: canonical specs; settlement-wallet approach; P0 catalog onboarding.
