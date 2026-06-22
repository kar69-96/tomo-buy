# Open Decisions — human / legal sign-off (spec §15)

> Do not let the build paper over these. Each is referenced from the build-plan report template so
> phases flag when they brush against one. None is legal advice — they flag the surface.

## 1. Money-transmitter posture
Agentcard custodying funds/cards offloads most of this on the **card paths**, but the flow of *your
user's* money to Agentcard, and your role in it, should be blessed by a payments/fintech lawyer
before production. **P0 adds a separate surface:** since P0 uses no third-party rail, *we* hold the
x402/MPP **settlement wallet** (stablecoin treasury). Self-custodying and moving stablecoin to settle
purchases carries its own custody and (potentially) money-transmission/VASP considerations — confirm
how it's funded (own treasury vs. pass-through of user funds) and your role in that flow.
**Blocks:** P0 production. **Not blocking:** card-path build/sandbox.

## 2. Automated account creation in the user's real name
Some merchant ToS prohibit it; the *user* is bound by those terms. Get explicit user consent and a
disclosure that we create accounts on their behalf; confirm per-merchant ToS for Lane B merchants we
target. **Blocks:** P3 against any specific merchant. **Not blocking:** P2 guest.

## 3. Liability for bad purchases
Under EFTA, a consumer may be liable for an agent's mistakes once they grant it an access device, and
chargeback liability allocation is unsettled. Put this in user terms and keep the approval gate tight
on irreversible spend. **Mitigation in-build:** the §8 approval gate + re-validation.

## 4. Stealth / CAPTCHA against merchant ToS (Lane B)
An accepted risk — but scope which merchants we're authorized to automate against, and keep the
human-fallback / `EXPLAIN_CANT` path. **Affects:** P2/P3 Executor behavior.

## 5. Org plan ceilings & `/buy` capabilities
Confirm Agentcard org per-card limits (default $50) and whether `/buy` covers `account_bound` and
inbox redirection. **Blocks:** raising card amounts beyond $50; Lane A.

## 6. Inbox redirection on Lane A
Agentcard's `/buy` emits a confirmation to the user; confirm whether it goes to the user's real email
and whether org config can redirect it to our channel — otherwise it violates the no-inbox rule on
Lane A. **Blocks:** Lane A no-inbox compliance.

---

## Quick status matrix

| Decision | Blocks | Safe to build now without it |
|---|---|---|
| 1 Money transmitter (P0 wallet) | P0 production | Card rail + Lane B sandbox ✅ |
| 2 Auto account creation | P3 per merchant | P2 guest ✅ |
| 3 Liability / EFTA | production terms | sandbox build ✅ |
| 4 Stealth vs ToS | targeted merchant list | framework ✅ |
| 5 Org ceilings / `/buy` | >$50 cards; Lane A | ≤$50 card rail ✅ |
| 6 Lane A inbox redirect | Lane A compliance | Lane B ✅ |
