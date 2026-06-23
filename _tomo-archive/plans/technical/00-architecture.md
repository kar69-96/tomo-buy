# Architecture

> Read `../../CLAUDE.md` first. This doc defines components, the trust boundary, the monorepo
> layout, and the wave dependency graph.

## 1. Component flow

```
   user text
       │
       ▼
┌──────────────────────────────┐
│ Intent Parser (LLM)          │  intent-only — produces a validated TaskIntent and nothing else
└──────────────┬───────────────┘
               │ TaskIntent (untrusted until Executor re-validates)
               ▼
┌──────────────────────────────┐
│ Router (deterministic)       │  pure code over MerchantProfile + TaskIntent; no LLM, no I/O
└──────┬────────────────┬──────┘
 Lane A│                │Lane B
       ▼                ▼
┌──────────────┐  ┌─────────────────────────────────────────┐
│ Agentcard    │  │ Executor (TRUSTED side)                  │
│ /buy (MCP)   │  │  • Browserbase headless browser          │
│ — DEFERRED;  │  │  • Vault A (agent secrets)               │
│   stub in    │  │  • Vault B (user PII)                    │
│   this build │  │  • FundingRail (Agentcard card client)   │
└──────┬───────┘  │  • OTP relay channel                     │
       │          └──────────────────┬──────────────────────┘
       └───────────────┬─────────────┘
                       ▼
         ┌──────────────────────────────┐
         │ Approval + Recon State Machine│  (Temporal) — §8
         └──────────────┬───────────────┘
                        ▼
              user text UI (approve / OTP / claim)
```

## 2. Trust boundary (the spine of the system)

The **prime directive**: the LLM emits *intent only*. It never reads a vault, never sees a PAN,
never sees a password. The **Executor** is the only component that opens secrets and injects them
into a page/request, returning **only** a success/failure flag.

This is enforced **structurally**, not by convention:

| Layer | May decrypt / hold secrets? |
|---|---|
| `packages/intent` (LLM) | **No** — emits `TaskIntent` only |
| `packages/router` | **No** — pure function over config + intent |
| `packages/funding` | Holds the Agentcard client; `getCardSecret` output is handed **only** to the Executor |
| `packages/vaults` | **Yes** — sole owner of decrypt capability |
| `packages/executor` | **Yes** — sole component that injects secrets into a page; returns flags only |
| `packages/orchestrator`, `packages/api`, `apps/*` | **No** |

The app/LLM tier has **no decrypt capability**. Card secrets, vault fields, and tokens never enter
LLM context or logs. The Executor independently re-validates every model-emitted parameter against
hard guardrails before any side effect (see `10-executor-trust-boundary.md`).

## 3. Monorepo layout

pnpm workspaces + Turbo, TypeScript, Vitest, Zod at boundaries.

```
packages/
  core/          # shared types, errors, Zod schemas, config (the FROZEN contracts)
  funding/       # FundingRail + AgentcardRail (real) + BuyToolRail (Lane A stub)
  rails-x402/    # MachineRail (P0) — ported from AgentPay x402; wired in a deferred phase
  vaults/        # Vault A (agent secrets) + Vault B (user PII); KMS/AES-256-GCM
  intent/        # LLM intent parser → TaskIntent (intent-only)
  router/        # deterministic cascade (§6)
  executor/      # trusted-side Executor: Browserbase + placeholder injection (§12)
  orchestrator/  # Temporal workflows: approval/recon/orphan SM (§8)
  profiles/      # merchant capability profiles (§3.1) + P0 vendor catalog (§3.5)
  api/           # internal service contracts (§14)
apps/
  worker/        # Temporal worker process
  ui/            # minimal text/portal: approve / OTP relay / claim
```

Each package owns its directory. Phases never edit another phase's package (see wave graph).

## 4. Wave dependency graph

```
WAVE 1  phase-00  packages/core (+ workspace config) + stubs of every package   [solo, blocking]
                  └ freezes all interfaces/types so Wave-2 can compile against them
WAVE 2  phase-01  packages/funding, packages/rails-x402   ┐
        phase-02  packages/intent, router, profiles       │ PARALLEL — disjoint dirs
        phase-03  packages/vaults, executor                │
        phase-04  packages/orchestrator, apps/worker       ┘
WAVE 3  phase-05  packages/api, apps/ui — integrate Wave-2 into the live Lane B P2 path
WAVE 4+ deferred/* — Lane A /buy, P0 machine rail, P3 signup, agent email, P1 SSO, drift checks
```

See `../build-plans/WAVES.md` for gating rules. The key property: **Phase 0 freezes the contracts**,
so the four Wave-2 sessions never redefine shared shapes and never touch each other's files.

## 5. Lane A vs Lane B (this build)

- **Lane A** (Agentcard partner merchants, e.g. DoorDash): Agentcard's `/buy` MCP tool runs the
  whole checkout. **Deferred** — `/buy` is not in the public docs (see `../spec/01-reality-reconciliation.md`).
  In this build the router still has a Lane-A short-circuit, but it routes to a `BuyToolRail` **stub**
  that returns `EXPLAIN_CANT(reason="lane_a_unavailable")`.
- **Lane B** (everything else): we run checkout via the Executor on Browserbase, paying with an
  Agentcard single-use card injected trusted-side. The live slice targets **P2 (guest checkout)**.
