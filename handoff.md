# Handoff — Tomo-buy headless checkout flow

_Last updated: 2026-06-23. Picks up from a session that verified the flow end-to-end, wired
AgentMail, upgraded logging/traces, and fixed a batch of real checkout bugs._

## The goal (user's intent)

The flow should be: **user intent → orchestrator plans the best approach (incl. login/signup
method: agent identity vs. existing-email OTP via Composio) → headless subagent executes the task
with a computer-use model (vision + DOM).**

## Architecture verdict (verified)

The described architecture exists and is ~70% wired:
- **Intent in** ✅ `POST /api/run { task }` → `startRun()` (`packages/api/src/routes/run.ts`, `packages/planner/src/run.ts`).
- **Plan + login method** ⚠️ Planning lives in `packages/planner/` (NOT `orchestrator/`). `plan()` =
  `planSteps()` + `buildBrief()`; login choice via `resolveStrategy()` (`identity/src/resolver.ts`)
  picking `agent` / `connected_otp` / `connected_session` / `guest`. **Composio is still a stub**
  (`identity/src/composio.ts`) → today everything defaults to a fresh agent identity; the `connected_otp`
  branch can't fire. (COMPOSIO_API_KEY is set in .env but the real client isn't wired in.)
- **Headless subagent** ⚠️ Real vision+DOM iterative loop (`checkout/src/act.ts`) on `gpt-4o-mini`
  (not a true computer-use model). Works, with the fixes below.

User directives still open:
1. **Unify under "orchestrator"** — fold `@tomo/planner` into `@tomo/orchestrator` so it both plans and
   exposes query/buy/confirm. (NOT started — this is Phase B. Plan file:
   `~/.claude/plans/i-want-you-to-misty-candle.md`.)
2. Composio OTP, true computer-use model, tighter planner→subagent prompt = explicitly deferred.

## What got DONE this session (in the working tree, NOT yet git-committed)

### New capability
- **AgentMail provisioned + wired.** Their signup endpoint is public, no dashboard needed:
  `POST https://api.agentmail.to/v0/agent/sign-up { human_email, username }` → `{ api_key, inbox_id }`.
  Provisioned inbox **tomobuy@agentmail.to**, key written to `.env` as `AGENTMAIL_API_KEY` (gitignored).
  Free tier: 3 inboxes / 3k emails/mo. SDK verified connecting.

### Bug fixes (with unit tests; full suite 464 passed / 28 skipped, build clean)
1. **LLM request had NO timeout** (`checkout/src/llm.ts`) — a hung OpenRouter fetch stalled the WHOLE
   run for 5 min (this was the new-account "Target page closed" failure). Added `AbortController`,
   default 60s, override via `LLM_TIMEOUT_MS` env or `timeoutMs` option. Test: `tests/llm-timeout.test.ts`.
2. **Headless bot-block** (`checkout/src/session.ts`) — added `--disable-blink-features=AutomationControlled`,
   strip `navigator.webdriver` via init script, fixed the UA (was hardcoded Chrome/120 which mismatches
   real Chrome's sec-ch-ua; now only override headless to drop the `HeadlessChrome` tell).
   ⚠️ Helps but does NOT defeat a COLD visit to a hardened Shopify site (see Gotchas).
3. **Over-purchase — root cause = cart cookie persistence** (`checkout/src/cache.ts`) — the per-domain
   cache replayed the Shopify `cart` cookie across runs, so each run kept adding to the SAME cart
   (totals climbed $30→$47→$59, same checkout token). Added `cart`/`checkout`/`basket` to
   `UNSAFE_COOKIE_PATTERNS` (applies to cookies AND localStorage). Test updated in `tests/cache.test.ts`.
4. **Over-purchase — within-run** (`checkout/src/task.ts`) — added `QTY_GUIDANCE` to product
   instructions: buy exactly 1 unit, never a multi-pack/bundle/subscription/"most popular".
5. **Stale agent identity** (`identity/src/agent-identity.ts`) — an identity created before AgentMail
   has a `@tomo.local` placeholder email that can't receive OTP. Now self-heals: if a placeholder
   identity is loaded and AgentMail is configured, it upgrades to a real inbox in place. Test:
   `identity/tests/agent-identity.test.ts`.
   NOTE: `~/.tomo/identities.json` currently still holds the old `tomo_id_21qzh9` w/ `.local` email — the
   self-heal fixes it on the next agent run, OR delete that file to force a clean re-provision.

### Logging / traces upgraded (the user explicitly asked for this)
- **`run.log`** — new `checkout/src/log.ts` tees `console.{log,info,warn,error}` to `<traceDir>/run.log`
  with `[+Ns]` elapsed prefixes. Installed in `task.ts` after session create, stopped in `finally`.
- **`summary.json`** — end-of-run rollup (status, durationMs, pages, llmCalls, strategy, observedTotal,
  finalUrl/PageType/step) via `CheckoutTracer.writeSummary()` in `trace.ts`.
- **per-record `durationMs` + `details`** added to `TraceRecord`.
- Tests: `tests/log.test.ts`, `tests/trace.test.ts` (+summary). These logs IMMEDIATELY paid off —
  elapsed timestamps exposed the 196s LLM hang and the cart-accumulation.

### A reverted misstep (don't reintroduce)
- Tried capping product-page LLM fallback to `maxSteps:4` — it BROKE add-to-cart (the product page
  genuinely needs ~9 rounds to dismiss popups, select a variant, scroll the button into view).
  Reverted to default. The latency was the hung LLM call (#1), not the round count.

## Validation state (live e2e, no-spend `DRY_RUN_NO_SPEND=1`)

| Scenario | Result |
|---|---|
| Build + 464 unit tests | ✅ green |
| guest-shop **headful, warm cache** | ✅ reached PARKED-payment, no spend |
| guest-shop **headless, warm cache** (clearance cookies cached) | ✅ reached PARKED-payment (stealth fix worked) |
| guest-shop **COLD cache** (headless or headful) | ⚠️ blank/blocked or `page.goto` timeout — primalkitchen cold-visit bot defense |
| new-agent-account | ⚠️ create_account + purchase_confirm gates fire ✅, no spend ✅; hung pre-timeout-fix — needs a re-run to confirm the fix unblocks it |
| booking-loop / frontier | not run this session |

**Still unproven end-to-end:** that the cart-cookie + QTY fixes drop the observed total to a SINGLE
unit. The decisive clean headful run hit a transient `page.goto` 30s network timeout. **Re-run it first
next session.**

## How to run / verify

```bash
pnpm install && pnpm build && pnpm test          # all green
# One live no-spend scenario (headful renders most reliably):
rm -f ~/.tomo/cache/primalkitchen.com.json       # start with a clean cart
HEADLESS=false E2E_LIVE=1 LLM_TIMEOUT_MS=45000 \
  pnpm vitest run e2e/scenarios/guest-shop.e2e.test.ts
# Then read the trace:
TD=$(ls -dt traces/guest-shop-* | head -1); cat "$TD/summary.json"; cat "$TD/run.log"
```
Expectation if cart/qty fixes hold: `observedTotal` ≈ ONE Dijon Mustard ($5.49) + shipping/tax
(~$14), NOT $30–59.

## Gotchas (read before debugging)
- **Cold headless on hardened sites is blocked.** primalkitchen (Shopify) serves a blank page to a
  no-cache headless (and sometimes headful) visit. Once a headful/warm run caches the bot-clearance
  cookies (e.g. `cf_clearance`), subsequent headless runs work. Production fix =
  `BROWSER_RUNTIME=browserbase` (stealth cloud) per the .env/README. Our `cart` filter intentionally
  does NOT drop clearance cookies, so warm-up still works.
- **Always clear `~/.tomo/cache/primalkitchen.com.json` between cart tests** or you'll see stale
  accumulation from a pre-fix cache (those still contain a `cart` cookie).
- **e2e imports BUILT dist** (`pnpm build` first). The `@tomo/planner` alias is in `vitest.config.ts`
  — update it when Phase B removes the planner package.
- `.env` is loaded by `vitest.config.ts` (not auto). Keys present: OPENROUTER, AGENT_MODEL, EXA,
  VAULT_KEY, COMPOSIO, AGENTMAIL. AGENTMAIL is the one added this session.

## Suggested next steps (priority order)
1. Re-run guest-shop (clean cache, headful) to CONFIRM `observedTotal` = 1 unit. If still high, open the
   parked screenshot `002-PARKED-payment.png` and check the line-item quantity (qty selector vs double-add).
2. Re-run new-agent-account to confirm the LLM-timeout fix unblocks the hang + the identity self-heals.
3. **Phase B: unify planner under @tomo/orchestrator** (plan file above). Move
   `planner/src/{plan,brief,run,capabilities}.ts` → `orchestrator/src/planning/`, re-export from the
   barrel, repoint `api/src/routes/run.ts` + `vitest.config.ts`, delete `@tomo/planner`.
4. Wire the real Composio client so `connected_otp` works (currently stubbed).

## Changed files
- M `packages/checkout/src/{cache,llm,session,task,trace}.ts`
- A `packages/checkout/src/log.ts`
- M `packages/checkout/tests/{cache,trace}.test.ts`
- A `packages/checkout/tests/{llm-timeout,log}.test.ts`
- M `packages/identity/src/agent-identity.ts`
- A `packages/identity/tests/agent-identity.test.ts`
- `.env` (AGENTMAIL_API_KEY added — gitignored)

Nothing has been git-committed yet.
