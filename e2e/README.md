# Live E2E scenarios — real browser, no spend

These specs drive the planner end-to-end through `startRun`/`resumeRun` (the same
path as `POST /api/run`) with a **real** local Chrome, real OpenRouter LLM, real Exa
discovery, and real identity resolution. They run in **no-spend oversight mode**:
`DRY_RUN_NO_SPEND=1` makes `confirm()` skip Agentcard issuance and stop the browser at
the payment page — so a run is *structurally incapable* of spending money.

They self-skip unless `E2E_LIVE=1`, so a normal `pnpm test` never launches a browser.

## Scenarios

| File | Login path | Gates | Proves |
|---|---|---|---|
| `frontier-user-account.e2e.test.ts` | sign in as the user (OTP via connected Gmail, or session token) | `session_token?` → `purchase_confirm` | connected-account login, no spend |
| `guest-shop.e2e.test.ts` | guest (no login, no account) | `purchase_confirm` | guest checkout, no spend |
| `new-agent-account.e2e.test.ts` | new throwaway agent account | `create_account` → `purchase_confirm` | account creation, no spend |

## Run

```bash
pnpm build                      # required: e2e imports built @tomo/* packages
E2E_LIVE=1 pnpm vitest run e2e/scenarios/guest-shop.e2e.test.ts
E2E_LIVE=1 pnpm vitest run e2e/scenarios/new-agent-account.e2e.test.ts
E2E_LIVE=1 pnpm vitest run e2e/scenarios/frontier-user-account.e2e.test.ts
```

Required `.env`: `OPENROUTER_API_KEY`, `AGENT_MODEL`, `EXA_API_KEY`, `VAULT_KEY`,
`COMPOSIO_API_KEY` (Frontier OTP), `AGENTMAIL_API_KEY` (scenario 3 registration).
Optional: `E2E_FRONTIER_SESSION_TOKEN`, and `E2E_GUEST_URL` / `E2E_NEW_ACCOUNT_URL` /
`E2E_FRONTIER_URL` to point a run at a known-good product.

## What you get

- A visible Chrome window (`HEADLESS=false`) you can watch.
- Per-run traces under `./traces/<scenario>-<timestamp>/`:
  - `trace.jsonl` — one record per page transition: page type, action, scripted-vs-LLM,
    login strategy, advanced/stall/llm counters, screenshot filename, outcome.
  - `NNN-<label>.png` — a screenshot per transition, ending in `PARKED-payment.png`.
  - `manifest.json` — session id + start time.

## Asserted invariants

Hard (fail the test): **no Agentcard ever issued** (no spend) and the planner chose the
right strategy (gate composition). Reaching the payment page is soft-checked and traced —
real sites with bot defenses (esp. Frontier) may block before payment.
```
