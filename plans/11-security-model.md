# Security Model — Bloon v1

## Auth Model

No API keys or registration in v1. API key auth planned for v1.5.

- All endpoints are open in v1 (single-operator, localhost deployment)
- $25 cap per transaction limits exposure
- Credit card credentials are stored in `.env` and never exposed to the LLM

**Accepted risk:** No auth means anyone with access to the server can initiate purchases. Mitigated by $25 cap, localhost-only deployment, and the plan for API key auth in v1.5.

## Threat Model

| Threat | Risk | Mitigation |
|--------|------|-----------|
| LLM sees card numbers | HIGH | Card fields filled via Playwright CDP (bypasses LLM entirely). Non-card fields use Stagehand `%var%` variables (not shared with LLM). |
| .env file leaked | HIGH | Contains card credentials. File permissions (600). Never committed to git. |
| Prompt injection | MEDIUM | Agents call structured REST endpoints. Stagehand receives step-by-step act() calls, not raw agent input. Shipping info sanitized. |
| Double-spend / replay | LOW | Unique order IDs. Order marked completed after fulfillment. |
| Failed purchase | LOW | Order status preserved. Manual intervention for v1. |
| Runaway spending | LOW | $25 cap. Two-phase (buy then confirm). |
| Browserbase session hijack | LOW | Sessions are ephemeral, destroyed after each checkout. |
| Agent-supplied data in forms | MEDIUM | Shipping info sanitized before passing as Stagehand variables. Card fields filled via CDP, not Stagehand. |
| LLM extraction hallucination | LOW | Parser ensemble scores candidates. Confidence threshold (0.75). Multiple extraction sources cross-validated. |

## Credential Flow

```
.env (local disk)
  │
  ├─ CARD_*, BILLING_*
  │     │
  │     ▼
  │   checkout/credentials.ts → { x_card_number: "4111...", ... }
  │     │
  │     ▼  Card fields: Playwright CDP fill (bypasses LLM)
  │     ▼  Non-card fields: Stagehand variables (not shared with LLM)
  │
  └─ API keys (BROWSERBASE_*, GOOGLE_*, etc.) → server-side only
```

## What the LLM Can See

| Data | Visible? |
|------|----------|
| Product name, URL, price | Yes |
| Shipping name and address | Yes |
| Order ID, receipt details | Yes |
| Credit card number | **No** |
| Card expiry, CVV | **No** |
| Cardholder name | **No** |
| Billing address | **No** |
| API keys | **No** |

## v1 Limitations (Accepted)

1. No auth — acceptable for single operator, localhost only
2. No rate limiting — single operator, not public yet
3. No HTTPS — localhost for v1. Deploy behind reverse proxy for production.
4. Card credentials in plaintext `.env` — filesystem permissions only
