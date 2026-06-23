# Phase 00 — Scaffold & Freeze Contracts

> **Self-contained runbook.** Read `../../../CLAUDE.md` for goals + rules. This file inlines
> everything you need; if it conflicts with `../00-CONVENTIONS.md`, that file wins.

## Header

| | |
|---|---|
| **Phase id** | `phase-00` |
| **Wave** | 1 (SOLO, BLOCKING — nothing else starts until this merges) |
| **Goal** | Scaffold the pnpm+Turbo+TS+Vitest monorepo and **freeze every shared contract** + stub every package. |
| **Owns** | root workspace config; `packages/core/` (full); stub `packages/{funding,rails-x402,vaults,intent,router,executor,orchestrator,profiles,api}/`; stub `apps/{worker,ui}/` |
| **Depends on** | nothing (this is the root of the wave graph) |
| **Parallel-safe-with** | nothing (solo wave) |
| **Complexity** | Medium (broad but shallow; the value is correct, stable contracts) |

This phase is the keystone: Wave-2 phases compile against the interfaces frozen here and never
redefine them. Get the contracts right and four sessions build in parallel without conflict.

## Git-sync + worktree setup

The repo is already initialized: `main` exists with the documentation brain (`plans/` + `CLAUDE.md`)
as the `baseline` commit, pushed to the private GitHub repo `tomo-buy`. This phase branches off it.

```bash
cd /Users/karthikreddy/Downloads/GitHub/Demos/Tomo-buy
git checkout main && git pull --ff-only origin main
# work directly on a feature branch (no parallel sibling in Wave 1):
git checkout -b feat/phase-00
```

(No worktree needed for the bootstrap phase since there's no parallel sibling. Later phases use
`git worktree add`.)

**Dirs you may create/touch:** repo root config files, `packages/`, `apps/`.
**Do NOT touch:** `plans/` (the brain is frozen), `CLAUDE.md`.

## Scope (files to create)

Root config:
- `package.json` (workspace root, scripts: `build`, `test`, `lint`, `dev`), `pnpm-workspace.yaml`,
  `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `vitest.workspace.ts`, `.nvmrc` (Node 20+).

`packages/core/` (FULL — the frozen contracts):
- `src/types/funding.ts` — `FundingRail`, `MachineRail`, `CardholderRef`, `CardRef`, `PAN_CVV_EXP`, `Txn`, `ChargeEvent`, `Settlement`, `OrderSpec`.
- `src/types/profile.ts` — `MerchantProfile` (§3.1) + `automation_hostility` type (§3.4) + `P0VendorCatalogEntry` (§3.5).
- `src/types/intent.ts` — `TaskIntent` (§3.2) + `CartSpec`.
- `src/types/routing.ts` — `RoutingDecision`, `Path` enum (`P0|P1|P2|P3|P3_ASSISTED|AGENTCARD_BUY|EXPLAIN_CANT`), `ExplainReason` union.
- `src/types/vault.ts` — `VaultA`, `VaultB` interfaces (field-level release signature on B).
- `src/schemas/*.ts` — Zod schemas mirroring each type for boundary validation (`TaskIntentSchema`, `MerchantProfileSchema`, etc.).
- `src/errors.ts` — error hierarchy (`TomoError` base; `FundingError`, `RoutingError`, `ExecutorError`, `VaultError`, `ApprovalError`, `ReconciliationError`).
- `src/index.ts` — re-export everything.
- `src/**/*.test.ts` — Vitest specs: schema parse/round-trip, enum exhaustiveness, error subclassing.

Stub packages (each: `package.json`, `tsconfig.json`, `src/index.ts` exporting a typed stub that
imports the relevant `core` contract, and one placeholder `*.test.ts` asserting the stub compiles):
- `packages/{funding,rails-x402,vaults,intent,router,executor,orchestrator,profiles,api}/`
- `apps/{worker,ui}/`

## Contracts to freeze (get these right — Wave 2 depends on them)

```ts
// funding.ts
export interface FundingRail {
  ensureCardholder(userId: string): Promise<CardholderRef>;
  issueCard(userId: string, amountCents: number, merchantId: string): Promise<CardRef>;
  getCardSecret(cardRef: CardRef): Promise<PAN_CVV_EXP>;   // trusted-side only
  closeCard(cardRef: CardRef): Promise<void>;
  listTransactions(cardRef: CardRef): Promise<Txn[]>;
  onWebhook(event: ChargeEvent): void;
}
export interface MachineRail {
  pay(catalogVendorId: string, amountCents: number, order: OrderSpec): Promise<Settlement>;
  setControls(c: { dailyCents?: number; perTxCents?: number; allowedVendors?: string[] }): Promise<void>;
}
// routing.ts
export type Path = 'P0'|'P1'|'P2'|'P3'|'P3_ASSISTED'|'AGENTCARD_BUY'|'EXPLAIN_CANT';
export interface RoutingDecision { path: Path; merchantId: string; reasons: string[]; explain?: ExplainReason; }
```
(See `plans/technical/01-data-models.md` and `02-funding-rail.md` for the full field lists.)

## Implementation steps (TDD-first)

1. `pnpm init` workspace; add Turbo, TypeScript, Vitest, tsup, Zod, `@types/node`. Configure
   `pnpm-workspace.yaml` to include `packages/*` and `apps/*`.
2. Write `packages/core` Zod schemas + TS types. **Write the `.test.ts` first** (parse valid/invalid
   samples, assert enum exhaustiveness via a `satisfies` switch), then the types until green.
3. Generate the 11 stub packages with a tiny script or by hand: each exports a class/function stub
   `implements` the relevant core interface but throws `NotImplementedError` (from `core/errors`).
4. Add root scripts so `pnpm build` (turbo) and `pnpm test` (vitest workspace) traverse all packages.
5. Confirm a fresh `pnpm install && pnpm build && pnpm test` is green.

## Reuse pointers (from AgentPay)

- Error hierarchy + config typing: `useagentpay-x402/packages/sdk/src/errors.ts`, `config/types.ts`.
- Vitest + tmpdir test conventions: any `*.test.ts` under `useagentpay-x402/packages/sdk/src/` (e.g. `budget/budget.test.ts`).
- Monorepo shape (pnpm + Turbo + tsup): AgentPay root `package.json` / `turbo.json`.

## Definition of Done

- [ ] `pnpm install && pnpm build && pnpm test` green from a clean clone.
- [ ] `packages/core` exports every frozen interface/type/schema/error; ≥80% coverage on core.
- [ ] All 11 stub packages compile and import their core contracts.
- [ ] `git main` exists; nothing under `plans/` changed.

## Build & verify

```bash
pnpm install && pnpm build && pnpm test
node -e "require('./packages/core/dist/index.js')"   # sanity: contracts load
```

## PR creation

```bash
git push -u origin feat/phase-00
gh pr create --base main --title "phase-00: scaffold + freeze contracts" \
  --label "wave-1" --body-file plans/build-plans/reports/phase-00-report.md

# Auto-merge into main once the Definition of Done is green.
# Disjoint package dirs mean parallel wave PRs merge without conflict; no human hand-merge.
gh pr merge --squash --delete-branch --admin
```

## PR report (required)

Write `plans/build-plans/reports/phase-00-report.md` from the template in
`../reports/README.md`, commit it onto `feat/phase-00`, and use it as the PR body. Call out any
contract you were unsure about (Wave 2 inherits these — flag ambiguity loudly).
