# Build-Plan Conventions (shared by every phase)

This file holds the canonical runbook. Every `phase-*.md` inlines the parts it needs so it stays
standalone, but if anything conflicts, **this file wins**. Read `../../CLAUDE.md` first for goals + rules.

---

## 0. Before you start

- You are executing **one** phase file. It names exactly which package directories you own.
- Touch **only** those directories. Everything else is another phase's territory — editing it causes
  merge conflicts with parallel wave siblings.
- Honor the prime directive and rules in `../../CLAUDE.md` (secrets never reach the LLM; TDD; cents).

---

## 1. Git-sync + worktree setup (run first, every time)

```bash
# 1. Sync main so you branch off the latest merged wave + any new PRs
cd /Users/karthikreddy/Downloads/GitHub/Demos/Tomo-buy
git checkout main
git pull --ff-only origin main      # if no remote yet, skip; main is local source of truth

# 2. Create an isolated worktree + branch for this phase
git worktree add ../tomo-<phase-id> -b feat/<phase-id>
cd ../tomo-<phase-id>

# 3. Install
pnpm install
```

If the repo has no `main` yet (only before phase-00 lands), phase-00 initializes it:
`git init && git add -A && git commit -m "chore: scaffold" && git branch -M main`.

---

## 2. Build & test loop

```bash
pnpm build                    # turbo build across workspace
pnpm test --filter <pkg>      # your package's Vitest suite
pnpm test                     # full suite before opening the PR
pnpm lint                     # if configured
```

TDD is mandatory: write the Vitest spec first (RED), implement to green, refactor. A phase is not
Done with any failing test or with <80% line coverage on the package(s) it owns.

---

## 3. Commit hygiene

- Conventional commits: `feat: …`, `fix: …`, `test: …`, `chore: …`, `refactor: …`.
- One logical change per commit; keep history bisectable.
- Never commit secrets, `.env`, or sandbox keys. Use `.env.example` placeholders.

---

## 4. PR creation

```bash
git push -u origin feat/<phase-id>
gh pr create \
  --base main \
  --title "<phase-id>: <one-line goal>" \
  --label "wave-<n>" \
  --body-file plans/build-plans/reports/phase-<phase-id>-report.md
```

PR body = the report (below). Title = phase id + goal. Base = `main`.

---

## 5. PR report (HARD RULE)

When you open the PR you **must** write `plans/build-plans/reports/phase-<phase-id>-report.md`,
**commit it onto the PR branch**, and use it as the PR body. Use the template in
`reports/README.md`. The report must be **honest about failures** — a green-washed report is a
defect. It covers: what was built, test results + coverage %, failures/known-gaps (with triage),
deviations from the plan, follow-ups, and which `plans/spec/02-open-decisions.md` items were touched.

---

## 6. Definition of Done (every phase)

- [ ] All owned files created; nothing outside the owned dirs changed.
- [ ] `pnpm build` green; `pnpm test` green; coverage ≥ 80% on owned packages.
- [ ] Behavioral checks in the phase file pass (each phase lists its own).
- [ ] Prime-directive check: no secret in LLM context or logs (grep the test transcript).
- [ ] `report.md` written, committed, and used as the PR body.
- [ ] PR opened against `main` with the `wave-<n>` label.

---

## 7. Wave discipline

- A wave's phases run **in parallel** on disjoint dirs.
- A wave is **complete only when every phase PR in it is merged to `main`** (see `WAVES.md`).
- Do not start a later-wave phase until its prerequisite wave is fully merged — your git-sync step
  depends on that merged code existing on `main`.
