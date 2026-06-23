# Glossary

| Term | Meaning |
|---|---|
| **Agentcard** | The funding provider. Issues single-use virtual cards, holds PCI scope + the funding relationship. We integrate its Organizations REST API. |
| **Lane A** | Agentcard partner merchants; Agentcard's `/buy` tool runs checkout. **Deferred** (undocumented). |
| **Lane B** | All other merchants; we run checkout via the Executor on a headless browser. |
| **P0** | Terminal/programmatic path — pure backend call over a sanctioned machine rail (x402/MPP). Zero user-data custody. |
| **P1** | SSO path — user authorizes their own existing account; we receive a scoped, revocable token. |
| **P2** | Guest path — checkout with no account, supplying only the form's required PII. |
| **P3** | New-provisioned path — agent creates an account for the user with agent-minted credentials. |
| **P3_ASSISTED** | P3 with human-relayed OTP/CAPTCHA when `automation_hostility == high`. |
| **AGENTCARD_BUY** | Lane A terminal — route the intent to Agentcard's `/buy`. |
| **EXPLAIN_CANT** | Honest terminal — no sanctioned path; disclose what's lost; offer guest/fresh/abort. |
| **Prime directive** | The LLM emits intent only; never sees a vault/PAN/password. |
| **Executor** | The trusted-side component — the only thing that opens secrets and injects them into a page/request. Returns flags only. |
| **TaskIntent** | The structured, validated output of the Intent Parser. Carries references, never secrets. |
| **MerchantProfile** | Static per-merchant capability config (lane, flags). Re-derived each run → self-upgrading. |
| **account_bound** | Intent flag: the request references something only the user's own account holds ("my usual", "my credit"). |
| **Vault A** | Agent-created secrets (minted passwords), scoped per (user, merchant). Revocable, low blast radius. |
| **Vault B** | User PII (name, address, email, phone). Stricter: field-level release, audit log, deletion path. |
| **automation_hostility** | Derived score (low/med/high) folding CAPTCHA, phone-gating, fingerprinting, fresh-signup flagging. Gates P3. Replaces the dead `fresh_account_risk`. |
| **terminal_rail** | Profile flag: merchant exposes a sanctioned machine rail. True ⟺ vendor is in the P0 catalog. |
| **sso_grant** | Profile flag: merchant offers consumer SSO/OAuth returning a scoped revocable token. |
| **forces_3ds** | Profile flag: payment step forces 3DS/step-up. On Lane B → terminal EXPLAIN_CANT. |
| **FundingRail** | The card-rail interface; `AgentcardRail` implements it; `BuyToolRail` stubs Lane A. |
| **MachineRail** | The P0 interface; `X402Rail`/`MPPRail` implement it (deferred). |
| **x402** | Coinbase's stablecoin-native HTTP 402 settlement standard (machine rail). |
| **MPP** | Machine Payments Protocol (machine rail). |
| **Settlement wallet** | Self-held stablecoin treasury wallet for P0. Keys server-side, never in model context. |
| **Browserbase** | Cloud headless browser used by the Executor for Lane B P2/P3. |
| **Placeholder injection** | The Executor pattern: LLM sees `%card_number%`; real value swapped into the DOM milliseconds before submit. |
| **Three-way oracle** | P3 signup existence outcomes: PROCEEDED / DEFINITIVELY_EXISTS / INDETERMINATE. |
| **Webhook event store** | Append-only store of verified Agentcard webhooks; the reconciliation source of truth. |
| **Approval gate** | Human authorization before any irreversible spend. **We own it** (not an Agentcard feature). |
| **OTP relay** | Default phone/email verification: the user relays the code they received via the text UI. |
| **Account claim** | User-initiated handoff: set email-of-record to theirs + password reset, so they own the agent-made account. |
| **Wave** | A group of build phases that run in parallel; must fully merge before the next wave starts. |
| **Phase** | One self-contained build work order (one package or two), owning disjoint directories. |
| **AgentPay** | The reference codebase at `/Users/karthikreddy/Downloads/GitHub/AgentPay` we port from. |
