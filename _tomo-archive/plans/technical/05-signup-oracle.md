# Signup Existence Oracle (§7) — Lane B P3

> **Status: DEFERRED** (P3 is a deferred phase). Documented now so the contract is fixed.

The original plan modeled signup existence as a clean two-way bounce (exists / doesn't). Real
anti-enumeration merchants make it **three-way**, and sometimes **asynchronous**. Model all of it.

## The three-way oracle

```
issue: attempt signup with the user's identifier (agent email; phone via OTP relay)

OUTCOMES:
  PROCEEDED            → no account existed → continue P3 to checkout
  DEFINITIVELY_EXISTS  → "already registered" bounce
                         → if profile.sso_grant: P1 ;  else: EXPLAIN_CANT(offer guest/abort)
  INDETERMINATE        → CAPTCHA / network error / identical "check your email" response
                         → DO NOT burn the identifier; do NOT retry blindly.
                           Wait for an async existence signal (email arrives → reclassify),
                           else EXPLAIN_CANT(reason="couldnt_determine").
```

## State machine

```
            ┌─────────────┐
   signup → │  ATTEMPTING │
            └──────┬──────┘
        ┌──────────┼───────────────┐
        ▼          ▼               ▼
   PROCEEDED   DEFINITIVELY     INDETERMINATE
        │       _EXISTS              │
        │          │          (await async signal:
   continue P3   P1 or          email lands → reclassify
   → checkout    EXPLAIN_CANT    to PROCEEDED/EXISTS;
                                 timeout → EXPLAIN_CANT)
```

## Hard rules (kept, sharpened)

- **One attempt per identifier, only on a DEFINITIVE result.** An `INDETERMINATE` failure must
  **not** consume the identifier — a failed-then-retried signup looks like enumeration to fraud teams.
- **Probe only the consented user's own identity, only at the moment of acting.** Never pre-scan,
  sweep, or speculatively check identifiers.
- **Lazy, not eager.** The existence probe is **never a separate step** — it is the *first side
  effect* of the P3 signup attempt, and only runs when guest checkout is unavailable. If guest
  works (P2), you never probe at all.

## Why three-way + async

Anti-enumeration merchants deliberately return an **identical** "we sent you an email" response
whether or not the account already existed (so attackers can't enumerate which emails are
registered). That collapses "exists" and "doesn't exist" into one observable response →
`INDETERMINATE`. The only honest disambiguator is the **async** signal: an actual email arriving
(or not) in the agent inbox lets us reclassify after the fact. Until then we neither proceed
destructively nor burn the identifier.

## Interfaces (frozen in core; implemented in the deferred P3 phase)

```ts
type SignupOutcome = "PROCEEDED" | "DEFINITIVELY_EXISTS" | "INDETERMINATE";
interface SignupOracle {
  attempt(user: string, merchant: string, identifier: string): Promise<SignupOutcome>;
  // async reclassification hook fed by the agent inbox (see 07-email-architecture.md)
  reclassifyFromInbox(user: string, merchant: string): Promise<SignupOutcome | null>;
}
```

## Dependencies

P3 + this oracle need the **agent email infrastructure** (`07-email-architecture.md`) for the
identifier and the async signal, and the **OTP relay** (`08-phone-otp.md`) for phone-gated signups.
Both are deferred alongside P3.
