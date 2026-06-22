# The Paths — Approach & Tech Stack (§11)

Each path lists its **approach**, **when you land there**, and **tech stack**. The funding
instrument is the `FundingRail` (`02-funding-rail.md`): **Agentcard** card for all card-rail paths
(P1/P2/P3, Lane A); **direct x402/MPP** against our own settlement wallet for the P0 machine rail.

In the **current build only P2 is wired live**; P0/P1/P3 + Lane A are deferred (documented here).

---

## P0 — terminal / programmatic  *(deferred)*

**Approach.** A pure backend call against the merchant's sanctioned machine rail. No human, no
browser, no account. The agent forms the order as a structured request; the rail authorizes and
settles; you get a confirmation. The only path with **zero custody of user data**.

**When you land here.** `terminal_rail == true` — merchant exposes an agent/commerce API, x402/MPP
endpoint, or delegated-payment protocol; the vendor is in the self-maintained P0 catalog (§3.5).

**Tech stack.** In-house x402 client (Coinbase stablecoin-native HTTP 402) and/or MPP client — no
third-party issuer. The P0 vendor catalog supplies endpoint/protocol/order_schema. A
**settlement wallet we control** (USDC treasury, self-custody or wallet provider — **not Sponge**),
keys server-side only. Spending controls (per-day, per-tx, allowed-vendor allowlist) mirror the
executor guardrails. Ported from AgentPay `useagentpay-x402/packages/x402/` (see
`12-reuse-from-agentpay.md`).

---

## P1 — SSO integration + human approval  *(deferred)*

**Approach.** The user authorizes access to their **own existing account** via the merchant's SSO/
OAuth screen. They tap "connect," log in as themselves, clear their own 2FA, and what comes back is
a **scoped, revocable token — never a password, never a captured session.** Their real perks
(subscription, member pricing, credits) come back into play without us ever holding credentials.

**When you land here.** Task is `account_bound`, or P3 signup bounced `DEFINITIVELY_EXISTS` — and
`sso_grant == true`.

**Tech stack.** OAuth authorization-code **with PKCE** client. Encrypted per-user/per-merchant token
store with refresh + revocation. Human-approval surface (the connect tap + per-action confirm for
anything irreversible). A **re-link flow** for expired tokens — a first-class state, not an error.

---

## P2 — guest  *(LIVE in the current build)*

**Approach.** No account, no login, no existence question. Build the cart and check out as a guest,
supplying only the PII a guest checkout requires + the payment instrument. Simplest path, smallest
footprint — nothing to vault beyond what the form needs at the moment it needs it.

**When you land here.** `guest_checkout == true` and the task isn't account-bound. The existence
probe is **skipped entirely** — existence is irrelevant to a guest order.

**Tech stack.** Browserbase (headless, server-side) drives the guest checkout. **Vault B** for
field-level PII release. **Agentcard** single-use card scoped to merchant + amount; PAN injected
trusted-side via the placeholder-swap Executor (`10-executor-trust-boundary.md`). An **approval
gate** before the final irreversible "place order" click.

---

## P3 — new provisioned  *(deferred)*

**Approach.** The agent creates an account for the user (real name, address, the user's own
payment), with the agent **minting and owning the credentials.** Default when an account is required
but none exists. The generated credential lives in **Vault A** the model can never read; the user
never typed or saw a password.

**When you land here.** `guest_checkout == false`, `account_required == true`, and the signup
attempt `PROCEEDED` (no existence bounce). `P3_ASSISTED` is the same path with human-relayed OTP/
CAPTCHA when `automation_hostility == high`.

**Tech stack.** Agent email infra (`07-email-architecture.md`). Browserbase. **Vault A** (agent
secrets, per user+merchant). **Vault B** (PII, field-level, audited, deletion path). Agentcard
single-use card injected trusted-side. Approval gate before any irreversible action.

---

## AGENTCARD_BUY (Lane A)  *(deferred — `/buy` not in public docs)*

**Approach.** Route the parsed intent to Agentcard's `/buy` MCP tool; Agentcard collects customer
info, creates the account/connection, issues the card, and pays. We handle approval surfacing, OTP
relay, and the inbox-redirect caveat. **Blocked** until `/buy` access + schema are confirmed.

---

## EXPLAIN_CANT

A real, honest terminal — not a silent degrade. State plainly that the sanctioned door isn't
available, **disclose what's lost** (member price, saved order, points), and offer guest/fresh/
abort. When the only way in would require holding a credential we've decided not to hold, say so
and offer P2/P3.
