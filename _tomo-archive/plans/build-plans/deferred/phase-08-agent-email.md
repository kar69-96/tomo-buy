# Phase 08 — Agent email infrastructure

> **PREREQUISITE.** Wave 1 (phase-00) merged. No external blocker, but a **warmed, legit-looking
> custom domain** must be provisioned before live use (disposable/catch-all domains correlate with
> `automation_hostility` and get signups bounced — §9). This phase is the dependency for **phase-07 (P3)**.

- **Phase:** 08 — Wave 4+ (deferred; build before phase-07)
- **Goal:** A controllable agent inbox per user that is the signup address, recovery channel, and
  magic-link/OTP read channel — while the user's real inbox stays pristine (§9).
- **Owned packages:** `packages/email/` (new)
- **Depends on (merged):** phase-00
- **Complexity:** Medium

---

## 1. Git-sync + worktree setup

```bash
cd /Users/karthikreddy/Downloads/GitHub/Demos/Tomo-buy
git checkout main && git pull --ff-only origin main
git worktree add ../tomo-phase-08 -b feat/phase-08-agent-email
cd ../tomo-phase-08 && pnpm install
```

**Owned dirs:** `packages/email/`. Register the new package in the workspace per phase-00's
pre-declared package list (do not edit root config beyond adding this package's reference if phase-00
already reserved the slot).
**Do NOT touch:** other packages' internals.

## 2. Scope

- `EmailInbox` provider: **AgentMail** OR a catch-all domain + inbound parse via **SES / Postmark / Resend**.
- Per-user controllable inbox on **our** domain (merchant-facing address). All signup confirmations,
  OTPs, receipts, marketing land here.
- Inbound parse → structured events (signup confirmation, OTP code, "already registered" bounce,
  magic-link). Feeds phase-07's async oracle reclassification.
- **"Connect email" (read-only, optional, consented):** detect which merchants the user already has
  accounts with by searching **named senders only** → route those to P1/connect. Never slurp the mailbox.
- **Account-claim handoff (the one sanctioned exception):** user-initiated — set email-of-record to
  theirs, trigger a password reset to them. Also the §8 orphan-account exit.

## 3. Contracts consumed (frozen in phase-00)

Define and freeze the `EmailInbox` interface in phase-00 `packages/core` (or expose it from this
package and have phase-00 reserve the name). Methods: `provisionInbox(userId)`,
`pollFor(predicate)`, `parseInbound(raw)`, `connectReadonly(userId, senders[])`,
`claimAccount(userId, merchantId)`.

## 4. Implementation steps (TDD-first)

1. Spec inbound-parse event extraction (OTP regex, confirmation, bounce, magic-link) → implement.
2. Spec provider adapter (start with one: Postmark or AgentMail) behind `EmailInbox`.
3. **Hard rule test:** never plus-address the user's real domain (`user+merchant@gmail.com`) — the
   merchant-facing address must be on **our** domain. Assert addresses are ours.
4. Spec "connect email" with named-sender allowlist; assert no full-mailbox reads.
5. Spec account-claim handoff (email-of-record swap + reset trigger).

## 5. Reuse pointers

- No direct AgentPay equivalent (AgentPay is local-first, no email infra). Build fresh behind the interface.

## 6. Definition of Done

- [ ] `EmailInbox` implemented for one provider; inbound parse unit-tested for all event types.
- [ ] Address-on-our-domain rule enforced + tested; named-sender allowlist enforced.
- [ ] Account-claim handoff path implemented. ≥80% coverage.

## 7. Build & verify

```bash
pnpm build && pnpm test --filter @tomo/email && pnpm test
```

## 8. PR creation + report

```bash
git push -u origin feat/phase-08-agent-email
gh pr create --base main --title "phase-08: agent email infrastructure" \
  --label "wave-TBD" --body-file plans/build-plans/reports/phase-08-report.md

# Auto-merge into main once the Definition of Done is green.
# Disjoint package dirs mean parallel wave PRs merge without conflict; no human hand-merge.
gh pr merge --squash --delete-branch --admin
```

Write + commit `reports/phase-08-report.md`. Note domain-warming status and the Lane A inbox-redirect
caveat (§9) for phase-06 to pick up.
