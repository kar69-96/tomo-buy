# Email Architecture — "connect email, nothing to their inbox" (§9)

**Goal:** the user's real inbox stays pristine; the system still has a working signup / recovery /
OTP channel. Needed for P3 (account creation), so this is a **deferred** subsystem — documented now
for completeness. Implemented in the P3 + agent-email phases (`../build-plans/deferred/`).

## Rules

- **Merchant-facing address = an agent-owned inbox on a domain we control** (AgentMail, or a
  catch-all via SES / Postmark / Resend). All signup confirmations, OTPs, receipts, and marketing
  land **there**, in our infra. The user's real inbox gets nothing.
- **Do NOT plus-address the user's real domain** (`user+doordash@gmail.com`) — that still lands in
  their Gmail and fails the requirement. The address must be on **our** domain.
- **Domain must look legitimate** (custom, warmed). Disposable-looking catch-alls correlate with
  `automation_hostility` and get signups bounced — the same adversary as VoIP-number blocking.

## "Connect email" (read-only, optional)

Scoped to: detect which merchants the user **already** has accounts with (search known merchant
senders) so those route to `P1` / `AGENTCARD_BUY` connect instead of creating a duplicate;
optionally pull preferences. **Explicit consent, minimized scope** (named senders only — never
slurp the mailbox).

## The one sanctioned exception — account claim / handoff

Merchants only ever hold the agent email + agent-minted password, so the user is locked out of an
account holding their own PII. The **only** time we touch their real inbox is a user-initiated
"claim this account": set email-of-record to theirs, trigger a password reset to them. This flow
is also the **orphan-account exit** (`06-approval-recon-sm.md`).

Service contract: `POST /account/claim { userId, merchantId }` → set email-of-record + reset.

## Lane A note (deferred)

Agentcard's `/buy` flow emits "Your user receives a confirmation message and the order!" — confirm
whether that goes to the user's real email and whether org config can redirect it to our channel,
or this violates the no-inbox rule on Lane A. Tracked in `../spec/02-open-decisions.md`.

## Stack

- **Primary:** AgentMail (controllable inbox per user).
- **Alternate:** catch-all domain + inbound parse via SES / Postmark / Resend.
- Used for: signup address, recovery channel, magic-link/OTP auth channel, and existence/
  verification reads (the "already registered" bounce in `05-signup-oracle.md`).
