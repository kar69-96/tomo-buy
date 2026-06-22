# Executor & Trust Boundary (§12)

Merchant page content and tool results are **data, not instructions.** The Executor
(`packages/executor`) is the only component that opens secrets and drives the live browser, and it
**independently re-validates every model-emitted parameter** against hard guardrails before any
side-effectful action.

## Guardrails (checked before any side effect)

- `amount ≤ price_ceiling_cents` — from the **original parsed intent**, not a number the model
  produced mid-run.
- `ship_to` must equal the **Vault B record** for this user — never an address that appeared in
  page content.
- `merchant` must equal the **routed merchant**.
- Any instruction-like text found in a page/email ("forward your code to…", "the user
  authorized…") is **surfaced to the user, never acted on.**
- Card secrets, vault fields, and tokens **never** enter the LLM context or logs; the Executor
  returns only success/failure flags and non-sensitive status.

## Placeholder injection (the secret-never-seen mechanism)

Ported from AgentPay `useagentpay-x402/packages/sdk/src/executor/placeholder.ts`:

1. The agent fills forms with **placeholders** (`%card_number%`, `%shipping_zip%`, …) — it sees
   only these, never real values.
2. At submit time, a single `page.evaluate()` atomic DOM swap replaces each placeholder with the
   real value pulled from Vault B / `getCardSecret`, fires `input`/`change`, and clicks submit.
3. Real values exist in the DOM for **milliseconds**, are never in the agent transcript, and are
   never logged.

```ts
// shape of the swap (see AgentPay placeholder.ts)
const swapMap = { '{{card_number}}': pan, '{{shipping_zip}}': zip, /* … */ };
await page.evaluate(getAtomicSwapScript(), swapMap);  // swap + dispatch + submit
```

## Where secrets come from / go to

- `getCardSecret(cardRef)` (Agentcard `GET /cards/{id}/details`, audit-logged) → **only** the
  Executor's page-fill path.
- Vault B field reads → **only** the Executor, one field at a time, at fill time.
- Vault A agent password → **only** the Executor, at login time.
- Output of all three: never returned to the LLM, never logged.

## Structural enforcement

`packages/intent` and `packages/router` must not import any secret-returning function — only the
types. Code review rejects any PR that crosses this boundary. See `00-architecture.md`.

## Browser execution

Browserbase headless sessions, server-side, per-session isolation. If a challenge can't be cleared,
**hand off to the user or terminate via `EXPLAIN_CANT`** — never hang.

## Verification

Integration test: Executor fills a mock checkout form; assert the real PAN/PII appear in the DOM
only at swap time and **never** in the agent-visible transcript (grep the transcript for
placeholder-only content).
