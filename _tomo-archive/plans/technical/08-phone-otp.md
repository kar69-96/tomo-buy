# Phone / OTP Primitive (§10)

## Default = OTP relay

When a merchant demands SMS/email verification, surface **"enter the 6-digit code you just
received"** in the text UI; the user relays it. The user's real number is the account identifier;
we **never** provision a burner and **never** capture a session. This is the same human-in-the-loop
already budgeted for P1 and the approval gate — not a new compromise.

Service contract: `POST /otp/relay { workflowId, code }`.

## Hard lines

- **Do NOT provision pooled VoIP numbers** as the default — they are exactly what
  `automation_hostility: high` merchants (incl. DoorDash) block. They fail where you need them.
- **Never capture the user's session/cookies** to "skip" phone. That rebuilds the
  untrusted-credential-holding model the whole design rejects. A **scoped, revocable token the user
  deliberately grants** (SSO / P1) is fine; a scraped session is not. Keep that line bright.

## Router interaction

The router treats `phone_required && automation_hostility == high` as:

```
prefer P1  →  else P3_ASSISTED (OTP relay)  →  else EXPLAIN_CANT
```

See `04-router-cascade.md` Step 3.

## Storage

If the user's number is held at all, it lives in **Vault B** (PII), released field-at-a-time by the
Executor, never to the LLM. See `01-data-models.md`.

## Status in current build

OTP relay is exercised first by Lane A surfacing and by P3_ASSISTED — both **deferred**. The
relay primitive (`/otp/relay` contract + UI affordance) is defined in `packages/api` so the
Temporal workflow can await it, but the merchant flows that need it land in later waves.
