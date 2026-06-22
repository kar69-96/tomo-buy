# Vision

## What we're building

A server-side agent that **buys things for a user from a text prompt** — food delivery, groceries,
reservations, online goods. It runs headless. It never holds the user's pre-existing passwords and
never scrapes their existing sessions. It pays with **single-use virtual cards issued by Agentcard**,
which holds PCI scope and the funding relationship — so this system never custodies funds or card
numbers.

## The prime directive

**The LLM emits intent only.** It never reads a vault, never sees a PAN, never sees a password. A
trusted-side **Executor** is the only thing that opens secrets and injects them into a page or
request, returning nothing but a success flag.

Every architectural choice serves this one line. If a design puts a secret into model context or
logs, it is wrong by construction.

## Why this shape

- **No fund custody / no PCI scope.** Agentcard custodies funds and card data, not us. That resolves
  the hardest regulatory problem on the card paths.
- **No untrusted credential holding.** We never hold the user's real passwords or scrape sessions.
  When the user's own account is needed, they grant a **scoped, revocable token** (SSO) — a grant,
  not a key.
- **Revocable blast radius.** Secrets the agent *does* mint (signup passwords) live in a vault the
  model can't read, scoped to one merchant; a leak is worthless elsewhere.
- **Deterministic routing.** The user never picks a "path." A deterministic router decides everything
  from a per-merchant capability profile plus the merchant's own runtime responses.

## The only human-in-the-loop moments

1. A one-time card attach at Agentcard.
2. Per-purchase charge authorization (an approval gate we own).
3. An OTP relay when a merchant sends an SMS/email code.
4. An optional account-claim handoff.

Everything else is autonomous.

## Outcomes (what success looks like)

- **This build:** issue a single-use Agentcard card in sandbox, drive a real guest checkout via a
  headless browser, inject the PAN trusted-side, place the order behind an approval gate, and
  reconcile/clean up — a working **Lane B P2** vertical slice with the trust boundary intact.
- **Beyond:** Lane A (Agentcard `/buy`) for partner merchants once access is confirmed; P3
  account-provisioning; P1 SSO for the user's own accounts; P0 machine-rail for sanctioned
  agent-commerce endpoints. The router self-upgrades each merchant to the best available path over time.

## Non-goals

- We do not custody funds or card numbers (Agentcard does).
- We do not hold user passwords or scrape sessions.
- No recurring/auto-renew or subscriptions (single-use cards).
- No in-store / card-present.
- Lane A is **deferred** in this build (its `/buy` dependency is unverified — see `../spec/01-reality-reconciliation.md`).
