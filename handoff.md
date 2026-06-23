# Tomo-buy — Handoff (agentbuy core, Agentcard-funded)

The backend was **replaced wholesale** with a fork of `kar69-96/agentbuy` ("Tomo") and rewired to
this project's constraints. The old Tomo-buy backend (Temporal/intent-router/vaults) is archived
under `_tomo-archive/`.

Branch: **`feat/agentbuy-agentcard`** (off `main`). Local:
`/Users/karthikreddy/Downloads/GitHub/Demos/Tomo-buy`.

---

## 1. What it is now

A REST API that purchases a product from a URL (or NL search), driving a **local Chrome (Playwright)**
to complete checkout, paying with a **single-use virtual card issued per purchase by Agentcard**.

| Concern | Implementation |
|---|---|
| API | Hono REST: `POST /api/query` → `/api/buy` → `/api/confirm` (`packages/api`) |
| LLM | **OpenRouter** (`packages/checkout/src/llm.ts`, `packages/crawling/src/llm.ts`) |
| Browser | **Local Playwright Chrome** (`packages/checkout/src/session.ts`; `HEADLESS=false` to watch) |
| Discovery | **Exa + Playwright + OpenRouter** (`packages/crawling`, `packages/checkout/src/discover.ts`) |
| Funding | **Agentcard CLI** (`packages/checkout/src/agentcard.ts`); injected via CDP in `confirm()` |

**Prime directive preserved:** card PAN/CVV/expiry flow only into CDP injection (`fill.ts`), never to
the LLM or logs. Only the opaque card id is logged.

---

## 2. Status (TL;DR)

- **Build green; 329 unit tests pass** (13 network e2e skipped). `pnpm build && pnpm test`.
- Server **boots and the API responds** (validated `MISSING_FIELD`/`INVALID_URL`).
- **NOT yet run end-to-end against a real merchant** — that needs the human Agentcard setup + keys
  below, and is a **real purchase with real money**.
- Committed on `feat/agentbuy-agentcard` (2 commits: scaffold + integration). Not merged, no PR.

---

## 3. What YOU must do before a real run (human-only)

1. **Agentcard (one-time):**
   ```bash
   npx agentcard@latest signup --email you@example.com   # click the magic link
   npx agentcard@latest setup                            # name, phone, Stripe payment method
   npx agentcard@latest limit --amount 250               # cover your spend
   npx agentcard@latest whoami                           # confirm logged in
   ```
   (The agent cannot do this — it needs a browser + Stripe.) Preflight in `agentcard.ts` will block
   with a clear message if not logged in.
2. **`.env`** — currently has only `OPENROUTER_API_KEY`. Add:
   - `EXA_API_KEY=...` (for NL search; URL mode works without it)
   - Shipping defaults: `SHIPPING_NAME/STREET/CITY/STATE/ZIP/COUNTRY/EMAIL/PHONE`
   - Optionally `BILLING_*`, `AGENT_MODEL`, `HEADLESS=false`, `PORT=3010` (3000 is taken on this box)
   See `.env.example` for the full list.

---

## 4. How to run

```bash
pnpm install && pnpm build

# Terminal 1: API server (PORT=3010 because 3000 is occupied here)
PORT=3010 HEADLESS=false node --env-file=.env packages/api/dist/index.js
# (or: pnpm start  — defaults to PORT 3000)

# Terminal 2: drive it (query -> buy -> confirm)
curl -s -X POST localhost:3010/api/query  -H 'content-type: application/json' -d '{"url":"<product-url>"}'
curl -s -X POST localhost:3010/api/buy    -H 'content-type: application/json' \
  -d '{"url":"<product-url>","shipping":{"name":"...","street":"...","city":"...","state":"..","zip":"..","country":"US","email":"..","phone":".."}}'
# -> returns order_id and a quote. Nothing spent yet.
curl -s -X POST localhost:3010/api/confirm -H 'content-type: application/json' -d '{"order_id":"tomo_ord_..."}'
# -> issues a single-use Agentcard, drives Chrome to checkout, REAL purchase, returns a receipt.
```

Funding knobs (`.env`): `FUNDING=agentcard|static`, `AGENTCARD_BUFFER_PCT` (default 0.15),
`AGENTCARD_MAX_AMOUNT` (default 500), `AGENTCARD_BIN` (path to a global agentcard, else uses npx).

---

## 5. Package map

```
packages/
  core/         types, fees, JSON store (~/.tomo), config (FUNDING + Agentcard knobs), errors
  crawling/     discovery: Exa search + Playwright fetch + OpenRouter extraction (Firecrawl/Gemini removed)
  checkout/     session.ts (Playwright), task.ts (checkout loop), act.ts (OpenRouter act),
                fill.ts/agent-tools.ts (CDP card fill), agentcard.ts (funding), credentials.ts
  checkout-http/ HTTP checkout engine (deferred; browser path is the v1 path)
  orchestrator/ query()/buy()/confirm(); confirm() issues the Agentcard and injects it
  api/          Hono server (src/index.ts boots it)
_tomo-archive/  the original Tomo-buy backend + plans (reference only)
```

---

## 6. Known gaps / caveats (honest)

- **Real money:** every successful `/api/confirm` issues a real card and completes a real purchase.
- **Card under-funding → decline:** the card is sized to item price + buffer (default 15%) for
  tax/shipping, capped at `AGENTCARD_MAX_AMOUNT`. If a merchant's tax/shipping exceeds the buffer the
  charge can decline — raise `AGENTCARD_BUFFER_PCT`.
- **CLI parsing:** `agentcard` has no `--json`; `agentcard.ts` parses human-readable stdout with
  defensive regexes (unit-tested). If the CLI output format changes, parsing may break.
- **Browser checkout is brittle** on protected/anti-bot merchants (Amazon/Walmart → captcha/login).
  Simple/Shopify-style stores are realistic.
- **Per-variant pricing degraded:** `fetchVariantPriceBrowser`/`resolveVariantPricesViaBrowser` are
  no-ops (return base price for all variants) — the Stagehand swatch-clicker wasn't reimplemented.
- **3DS/OTP:** `agentcard 3ds` reading is wired in `agentcard.ts` (`read3dsCodes`) but not yet hooked
  into the checkout step-up flow (the loop still uses the AgentMail path if `AGENTMAIL_API_KEY` set).
- **checkout-http** engine is bypassed by default (uses static creds); browser path carries Agentcard.

---

## 7. Suggested next steps

- Do the Agentcard + `.env` setup (§3), then a **small real purchase on a simple store** to validate
  end-to-end; watch with `HEADLESS=false`.
- Hook `read3dsCodes()` into the checkout step-up page (replace/augment the AgentMail path in task.ts).
- Reinstate per-variant price resolution via the local Playwright agent if needed.
- Decide whether to keep `checkout-http` or delete it.
- Open a PR / merge `feat/agentbuy-agentcard` when satisfied.
