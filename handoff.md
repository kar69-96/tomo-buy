# Handoff — Tomo-buy headless checkout flow

_Last updated: 2026-06-23 (session 2). Previous session's work is now COMMITTED (`4af4af2`).
This session found the real root cause of the "cold visits are bot-blocked" failures — a
self-inflicted DOM-pruning bug, NOT bot defense — fixed it, and proved BOTH the guest-shop and
new-agent-account flows end-to-end to a single-unit ($13.05) no-spend parked checkout._

## ⭐ Session 2 — the decisive fix (read this first)

**"Cold visits are bot-blocked" was mostly WRONG.** primalkitchen renders fine in a plain browser
(verified: 14,179 words, 105 visible buttons, a working "Add to Cart $5.49"). The blank screenshots +
"stuck on product" came from **our own DOM-pruning step** in `checkout/src/task.ts` (step 8c), which
ran `document.querySelectorAll('[aria-hidden="true"]').forEach(e => e.remove())`. `aria-hidden` is a
screen-reader semantic, NOT a visibility flag — when a cookie-consent modal is open, the whole product
section (Add-to-Cart included) is `aria-hidden="true"`. The page had **332** such elements; removing
them deleted the entire page → 0 visible controls → blank screenshot → 5 wasted LLM rounds → "stuck".

Fixes this session (all in working tree, NOT committed):
1. **Removed the `[aria-hidden="true"]` deletion** from DOM pruning (`task.ts` 8c). Kept the safe
   `noscript` + `img@srcset` stripping. **This unblocked the entire flow** → scripted Add-to-Cart now
   succeeds in ~12s with **0 LLM calls**.
2. **Bogus product-identity selections** (`planner/src/plan.ts`) — the brief emitted
   `{product_name:"Dijon Mustard"}` as a `parameter`, which `reconcileSteps` fed to checkout as a
   "selection", producing the nonsense instruction _"Select exactly these options: product_name: Dijon
   Mustard"_ (no such page control) and forcing the slow LLM path. Added `toCheckoutSelections()` with a
   `NON_VARIANT_KEYS` denylist (product/name/sku/brand/url/…) that drops identity keys; genuine variants
   (size/color/scent) pass through. Site-agnostic.
3. **Redundant `quantity:"1"`** dropped (same filter) — it's the page default, but ANY non-empty
   selection forces the LLM path. This cut new-agent-account from **97s → 26s** (0 LLM). quantity 2+ kept.
4. **Stronger bot-block detection** (`task.ts`, `classifyPageHealth()`) — now also fails fast with an
   accurate `bot_blocked` reason when a page has **0 visible interactive controls** (a real challenge
   wall / failed render), instead of burning the LLM budget and mislabeling it "stuck on product".

Tests added: `planner/tests/plan.test.ts` (+5, selection filtering), `checkout/tests/page-health.test.ts`
(+4). Full suite **473 passed / 28 skipped**, build clean.

**Live validation (no-spend `DRY_RUN_NO_SPEND=1`, headful, clean cache):**
- guest-shop → **PARKED at payment, observed_total = $13.05** (Dijon Mustard ×1: $5.49 + $6.57 ship +
  $0.99 tax), **0 LLM calls, ~26s, reproduced twice.** Single unit confirmed (qty badge "1" in the
  parked screenshot). AgentMail inbox `tomobuy@agentmail.to` used.
- new-agent-account → **PARKED at payment, $13.05, 0 LLM, ~26s.** create_account + purchase_confirm
  gates fired, no spend. **Identity self-heal confirmed:** the stale `…@tomo.local` placeholder was
  upgraded in place to `tomobuy@agentmail.to` (inbox_id set, updated_at bumped).

---

_Below: prior session notes (still accurate except where session 2 supersedes the "cold = blocked"
gotcha and the "still unproven" validation rows)._

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
| Build + 473 unit tests | ✅ green (session 2: +9 tests) |
| guest-shop **COLD cache, headful** | ✅ **PARKED $13.05, 0 LLM, ~26s, reproduced ×2** (session 2 fix) |
| new-agent-account **COLD cache, headful** | ✅ **PARKED $13.05, 0 LLM, ~26s**; gates fire, no spend, identity self-heal ✅ |
| booking-loop / frontier (form_flow path) | not run — different code path (brief-driven), not a session-2 priority |

**Now PROVEN end-to-end:** single-unit observed total ($13.05, qty 1) via the fast scripted path on a
cold cache, for BOTH guest and new-account. The prior "transient `page.goto` timeout" did not recur.

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
- **⚠️ SUPERSEDED by session 2:** the "cold headless serves a blank page" symptom on primalkitchen was
  **mostly our own aria-hidden DOM-pruning bug** (now fixed), NOT bot defense. primalkitchen renders
  fine cold/headful. Genuinely-hardened sites (real Cloudflare challenges) can still block — those now
  fail FAST with an accurate `bot_blocked` reason (`classifyPageHealth`, incl. the 0-visible-controls
  signal) instead of looking "stuck". Production stealth fix remains `BROWSER_RUNTIME=browserbase`.
  The `cart` cookie filter still intentionally does NOT drop clearance cookies (e.g. `cf_clearance`).
- **Always clear `~/.tomo/cache/primalkitchen.com.json` between cart tests** or you'll see stale
  accumulation from a pre-fix cache (those still contain a `cart` cookie).
- **e2e imports BUILT dist** (`pnpm build` first). The `@tomo/planner` alias is in `vitest.config.ts`
  — update it when Phase B removes the planner package.
- `.env` is loaded by `vitest.config.ts` (not auto). Keys present: OPENROUTER, AGENT_MODEL, EXA,
  VAULT_KEY, COMPOSIO, AGENTMAIL. AGENTMAIL is the one added this session.

## Suggested next steps (priority order)
1. ~~Re-run guest-shop / new-agent-account~~ — **DONE (session 2), both PARK at $13.05, 0 LLM.**
2. **Commit session 2's working tree** (4 files below) — it's green and validated; not yet committed.
3. Optional: run the **frontier / booking-loop form_flow** scenarios. They use the brief-driven path
   (not the scripted product handlers), so the aria-hidden fix helps them too but they're unproven.
4. **Phase B: unify planner under @tomo/orchestrator** (plan file `~/.claude/plans/i-want-you-to-misty-candle.md`).
   Move `planner/src/{plan,brief,run,capabilities}.ts` → `orchestrator/src/planning/`, re-export from the
   barrel, repoint `api/src/routes/run.ts` + `vitest.config.ts`, delete `@tomo/planner`.
5. Wire the real Composio client so `connected_otp` works (currently stubbed).

## Changed files (session 2 — in working tree, NOT yet committed)
- M `packages/checkout/src/task.ts` — removed the destructive `[aria-hidden="true"]` DOM-prune;
  added `classifyPageHealth()` (text + 0-visible-controls bot-block detection) and wired step 8a-bot.
- M `packages/planner/src/plan.ts` — `toCheckoutSelections()`: drops product-identity keys
  (`NON_VARIANT_KEYS`) and a redundant `quantity:"1"`; exported `reconcileSteps` for tests.
- M `packages/planner/tests/plan.test.ts` — +5 selection-filtering tests.
- A `packages/checkout/tests/page-health.test.ts` — +4 `classifyPageHealth` tests.

(Prior session's work is COMMITTED as `4af4af2`. `.env` AGENTMAIL_API_KEY still present, gitignored.)
