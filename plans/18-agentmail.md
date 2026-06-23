# AgentMail Integration — Checkout Email Verification

## Why

Some checkout flows (Shopify email-first, merchant OTP) require a verification code sent to the buyer's email. Without an inbox under Bloon's control, these codes can't be retrieved programmatically. AgentMail gives Bloon its own email address so it can receive and extract codes during checkout.

## How AgentMail Works

AgentMail is an API platform for giving AI agents their own email inboxes.

- **Create inbox:** `client.inboxes.create()` → returns `{ inboxId }`. Email address is `{inboxId}@agentmail.to`.
- **List messages:** `client.inboxes.messages.list(inboxId, { after, limit })` → paginated list of messages with metadata.
- **Get message:** `client.inboxes.messages.get(inboxId, messageId)` → full message with `text`, `html`, `extractedText`, `extractedHtml` fields.

## Architecture

### Singleton Inbox

One inbox is created per process lifetime (cached in memory). All checkouts in the same process share the same email address. The inbox is created lazily on first use.

### Email Swap

In `runCheckout()`, if `AGENTMAIL_API_KEY` is set:
1. Create/reuse the singleton inbox
2. Replace `shippingData.email` and `stagehandVars.x_shipping_email` with the AgentMail address
3. Checkout forms now receive the agent email instead of the user-provided email

This is transparent — no type changes needed since `ShippingInfo.email` is already a string.

### Code Polling Loop

When `detectPageType()` returns `"email-verification"`:
1. Record current timestamp (to filter pre-existing messages)
2. Call `pollForVerificationCode(inboxId, timestamp, 60000)`
3. Polling checks every 4 seconds for new messages
4. For each new message, fetch full body and run code extraction patterns
5. Return the extracted code, or null after 60s timeout

### Code Extraction Patterns

Applied in order (first match wins):

```
/verification code[:\s]*(\w{4,8})/i    — "Verification code: 123456"
/\bcode[:\s]+(\w{4,8})\b/i             — "Your code: ABC123"
/\b(?:one-time|otp|passcode)[:\s]*(\w{4,8})\b/i  — "OTP: 1234"
/\b(\d{4,8})\b/                        — any 4-8 digit number (broadest)
```

### Page Detection

Email verification pages are detected by `detectPageType()` when BOTH conditions are true:
- Text signals: "verification code", "enter code", "we sent", "check your email", "one-time", "OTP", etc.
- DOM signals: short input fields (autocomplete="one-time-code", name contains "code"/"otp"/"verification", maxlength 1-8)

### Code Fill

`scriptedFillVerificationCode(page, code)` handles:
- Single input with `autocomplete="one-time-code"`
- Named inputs (`name*="code"`, `name*="otp"`, etc.)
- Split OTP inputs (multiple `maxlength="1"` inputs — one digit per field)
- Short `maxlength` inputs (4-8 chars)

Uses the same native setter + event dispatch pattern as `scriptedFillShipping`.

## Environment Config

```env
AGENTMAIL_API_KEY=am_...    # Optional. Enables email verification support.
```

When not set, checkout proceeds normally without email swap. Verification code pages will fall through to LLM fallback.

## Timeout & Retry

- **Poll timeout:** 60 seconds (configurable)
- **Poll interval:** 4 seconds (configurable)
- **On timeout:** Falls through to LLM fallback, which gets the instruction "code is: still being retrieved"
- **On API error:** Logs warning, continues polling

## Security

- The AgentMail email address is not sensitive — it's a disposable inbox
- No credentials flow through AgentMail (only verification codes)
- The `AGENTMAIL_API_KEY` is a server-side secret, never exposed to the LLM
- Original shipping email is only replaced locally — the input `ShippingInfo` is not mutated

## Files

| File | Role |
|------|------|
| `packages/checkout/src/agentmail.ts` | Singleton client, inbox management, code polling + extraction |
| `packages/checkout/src/scripted-actions.ts` | `"email-verification"` page type, detection, `scriptedFillVerificationCode()` |
| `packages/checkout/src/task.ts` | Email swap, verification handler in page loop, LLM fallback instruction |
| `packages/checkout/src/index.ts` | Re-exports AgentMail utilities |
