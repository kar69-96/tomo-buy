# Product Scope

## Two lanes

| | **Lane A — Agentcard partner** | **Lane B — long-tail merchant** |
|---|---|---|
| Merchants | DoorDash, Good Eggs, + "coming soon" | Everything else |
| Who runs checkout | Agentcard (`/buy` MCP tool) | We do (browser automation) |
| Who collects PII | Agentcard | We do (Vault B) |
| Who creates the account | Agentcard | We do (P3 signup) |
| Card | Agentcard issues + charges internally | Agentcard issues, we inject PAN |
| Our work | route intent → `/buy`, relay approval/OTP | the full router below |

**Build order:** the spec says Lane A first (smallest surface, headline DoorDash use case). But the
`/buy` tool is **not in Agentcard's public docs**, so **Lane A is deferred** and stubbed. We build
the documented card rail + Lane B first. Lane B is the differentiator (arbitrary merchants) but
carries the hard problems (3DS, fresh-account fraud, orphan cleanup) — we start with its lowest-risk
path, **P2 guest checkout**.

## Four execution paths (cheapest viable wins)

| Path | When | Custody | Human-in-loop |
|---|---|---|---|
| **P0** terminal/programmatic | merchant has a sanctioned machine rail (`terminal_rail`) | **zero** user data | none |
| **P1** SSO + approval | task is `account_bound` or signup bounced "exists", and `sso_grant` | scoped revocable token | connect tap + approval |
| **P2** guest | `guest_checkout` and not account-bound | only the form's fields, at fill time | approval gate |
| **P3** new provisioned | account required, none exists | Vault A creds + Vault B PII | approval (+ OTP if hostile) |

Plus terminals: **AGENTCARD_BUY** (Lane A) and **EXPLAIN_CANT** (honest dead-end with disclosure).

## Use cases

- "Order sushi under $40 from my usual place" → `account_bound` → P1 (or EXPLAIN_CANT if no SSO).
- "Get me groceries from <merchant> delivered home" → guest if available → P2.
- "Sign me up at <merchant> and buy X" → P3 (account provisioned, agent-minted creds).
- "Buy this data feed" (agent-commerce endpoint) → P0 machine rail.
- Partner merchant (DoorDash) → Lane A `/buy` (deferred; stubbed today).

## In scope (this build)

- Documented Agentcard card rail (M0), verified hold→capture→release in sandbox.
- Deterministic router cascade with the ordering fix + dead-corner guards.
- Vaults A/B + Executor trust boundary.
- Temporal approval/recon/orphan state machine.
- One live path: **Lane B P2 guest checkout** on Browserbase with trusted-side PAN injection.

## Out of scope (this build, deferred to later waves)

- Lane A `/buy` (unverified dependency), P3 signup + three-way oracle, agent email infra, P1 SSO,
  full P0 machine rail + vendor catalog + settlement wallet, profile-drift health checks.
- Subscriptions / recurring, card-present, 3DS-forcing merchants on Lane B (terminal `EXPLAIN_CANT`).
