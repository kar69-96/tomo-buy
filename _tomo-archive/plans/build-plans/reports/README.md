# Build Reports

One report per phase lands here when that phase opens its PR (the **PR-report hard rule** in
`../00-CONVENTIONS.md`). The report is committed onto the PR branch and pasted into the PR body.

Reports are **honest about failures** — a green-washed report is itself a defect. If something
didn't work, the report says so, with triage.

## Index

| Phase | Wave | Report | Status |
|---|---|---|---|
| phase-00 | 1 | `phase-00-report.md` | _pending_ |
| phase-01 | 2 | `phase-01-report.md` | _pending_ |
| phase-02 | 2 | `phase-02-report.md` | _pending_ |
| phase-03 | 2 | `phase-03-report.md` | _pending_ |
| phase-04 | 2 | `phase-04-report.md` | _pending_ |
| phase-05 | 3 | `phase-05-report.md` | _pending_ |

(Update the row's Status to `merged` when the PR lands.)

---

## Canonical `report.md` template

Copy this into `phase-<id>-report.md` and fill every section.

```markdown
# Phase <id> Report — <one-line goal>

- **Wave:** <n>
- **Branch / PR:** feat/<phase-id> → #<pr-number>
- **Owned packages:** <dirs>
- **Date:** <YYYY-MM-DD>
- **Result:** ✅ complete | ⚠️ complete-with-gaps | ❌ blocked

## What was built
- <bullet list of packages/files + behavior delivered>

## Test results
- Command: `pnpm test --filter <pkg>`
- Suites: <pass>/<total>   Tests: <pass>/<total>
- Coverage (lines): <NN>%  (target ≥ 80%)
- Build: `pnpm build` ✅/❌

## Failures & known gaps  (be honest)
| Item | Severity | Why it failed / what's missing | Triaged to |
|---|---|---|---|
| <e.g. webhook signature verify> | high | <reason> | <follow-up / next phase / accepted> |

Failure-triage checklist:
- [ ] Every failing/skipped test is listed above with a reason.
- [ ] Every stub or `TODO` left in owned code is listed.
- [ ] Anything that "works locally but not in CI/sandbox" is called out.
- [ ] No secret leaked into logs/LLM context (verified).

## Deviations from the plan
- <where implementation differed from the phase file, and why>

## Follow-ups
- <new tasks discovered; which future phase should pick them up>

## Open-decision (§15) items touched
- <reference `plans/spec/02-open-decisions.md` items this phase brushed against>

## Sign-off
- [ ] Definition of Done in the phase file met
- [ ] Report is accurate and honest about what didn't work
```
