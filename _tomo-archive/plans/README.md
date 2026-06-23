# Tomo-buy — The Brain

This folder is the complete, self-contained documentation brain for the Agentic Checkout Router.
It is designed so a fresh agent session can read one build-plan file and autonomously build that
slice. Start with `../CLAUDE.md` (goals + rules), then read in the order below.

## Prime directive

The LLM emits **intent only** — it never reads a vault, never sees a PAN, never sees a password.
A trusted-side **Executor** is the only thing that opens secrets and injects them. Everything in
this brain serves that boundary.

## Reading order

### 1. Vision — *why*
- [`vision/00-vision.md`](vision/00-vision.md) — what we're building, the prime directive, outcomes
- [`vision/01-product-scope.md`](vision/01-product-scope.md) — two lanes, four paths, in/out of scope
- [`vision/02-glossary.md`](vision/02-glossary.md) — every term used across the brain

### 2. Spec — *the contract with reality*
- [`spec/00-original-spec.md`](spec/00-original-spec.md) — the source spec, verbatim, as canon
- [`spec/01-reality-reconciliation.md`](spec/01-reality-reconciliation.md) — **Agentcard docs vs spec**; what's actually buildable
- [`spec/02-open-decisions.md`](spec/02-open-decisions.md) — legal / sign-off blockers (§15)

### 3. Technical — *how*
- [`technical/00-architecture.md`](technical/00-architecture.md) — components, trust boundary, monorepo layout, wave graph
- [`technical/01-data-models.md`](technical/01-data-models.md) — profiles, TaskIntent, vaults, hostility, P0 catalog
- [`technical/02-funding-rail.md`](technical/02-funding-rail.md) — `FundingRail` + `AgentcardRail` + `MachineRail`
- [`technical/03-agentcard-client.md`](technical/03-agentcard-client.md) — documented endpoints, units, webhooks
- [`technical/04-router-cascade.md`](technical/04-router-cascade.md) — deterministic cascade (incl. ordering fix)
- [`technical/05-signup-oracle.md`](technical/05-signup-oracle.md) — three-way existence oracle
- [`technical/06-approval-recon-sm.md`](technical/06-approval-recon-sm.md) — approval/reconciliation/orphan SM
- [`technical/07-email-architecture.md`](technical/07-email-architecture.md) — agent inbox, no-inbox rule, claim
- [`technical/08-phone-otp.md`](technical/08-phone-otp.md) — OTP relay primitive
- [`technical/09-paths-detail.md`](technical/09-paths-detail.md) — P0/P1/P2/P3 approach + stack per path
- [`technical/10-executor-trust-boundary.md`](technical/10-executor-trust-boundary.md) — prompt-injection defense, guardrails
- [`technical/11-tech-stack.md`](technical/11-tech-stack.md) — component → vendor table
- [`technical/12-reuse-from-agentpay.md`](technical/12-reuse-from-agentpay.md) — exact files to port

### 4. Build plans — *the work*
- [`build-plans/00-CONVENTIONS.md`](build-plans/00-CONVENTIONS.md) — shared runbook (git-sync, build, PR, report)
- [`build-plans/WAVES.md`](build-plans/WAVES.md) — wave schedule + gating
- [`build-plans/reports/`](build-plans/reports/) — one report per phase (committed on PR)
- `build-plans/wave-1/` … `wave-3/` + `deferred/` — the phase work orders

## How to dispatch a build phase

1. Pick a phase file from the **current open wave** (see `build-plans/WAVES.md`).
2. Hand it to a fresh session. The file is self-contained — it opens with git-sync + worktree setup
   and ends with the PR + report steps.
3. Parallelize by handing **every phase in the same wave** to separate sessions at once.
4. When **all** PRs in a wave are merged to `main`, open the next wave.

## Status

Documentation brain complete. No application code exists yet — `phase-00` (Wave 1) creates the
first code. See `build-plans/WAVES.md` for what's next.
