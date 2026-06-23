/**
 * Renders a SiteSkillRecord into the human/LLM-readable SKILL.md.
 *
 * Pure: no I/O, no LLM. VARIABLE-vs-FIXED is decided ONLY from each selector's
 * `provenance` (no heuristics here). There is no value column anywhere in the
 * output, so a secret value is structurally unrepresentable in the rendered doc.
 */
import type { RecordedSelector, SiteSkillRecord, FieldProvenance } from "./skill-types.js";

/** STRUCTURAL + CDP_SECRET selectors are stable across purchases → FIXED. */
function isFixed(p: FieldProvenance): boolean {
  return p === "STRUCTURAL" || p === "CDP_SECRET";
}

function escapeCell(s: string): string {
  // Escape pipes/backticks so the markdown table stays well-formed.
  return s.replace(/\|/g, "\\|").replace(/`/g, "ˋ");
}

function selectorRows(selectors: readonly RecordedSelector[]): string {
  return selectors
    .map(
      (s) =>
        `| ${s.pageType} | ${s.action} | ${escapeCell(s.fieldLabel)} | \`${escapeCell(
          s.matchedSelector,
        )}\` | ${s.mode} |`,
    )
    .join("\n");
}

const TABLE_HEADER =
  "| Page | Action | Field | Matched selector | Mode |\n" +
  "|------|--------|-------|------------------|------|";

function renderTable(selectors: readonly RecordedSelector[], emptyNote: string): string {
  if (selectors.length === 0) return `_${emptyNote}_`;
  return `${TABLE_HEADER}\n${selectorRows(selectors)}`;
}

function renderFlow(record: SiteSkillRecord): string {
  if (record.pageFlow.length === 0) return "_No page flow recorded._";
  const chain = record.pageFlow.map((f) => f.pageType).join(" → ");
  const paths = record.pageFlow.map((f) => `- \`${escapeCell(f.urlPath)}\` (${f.pageType})`).join("\n");
  return `${chain}\n\n${paths}`;
}

/** Render a SiteSkillRecord to SKILL.md markdown. Deterministic. */
export function renderSkillMarkdown(record: SiteSkillRecord): string {
  const fixed = record.selectors.filter((s) => isFixed(s.provenance));
  const variable = record.selectors.filter((s) => !isFixed(s.provenance));

  return `# Checkout skill — ${record.domain}

> Auto-generated after ${record.successCount} successful checkout(s). Last verified ${record.lastVerifiedAt}.
> Schema v${record.schema}. The engine reads \`skill.json\` (beside this file) to replay these selectors.

## Page flow

${renderFlow(record)}

## Selectors

### Fixed (structural — stable across purchases)

${renderTable(fixed, "No fixed selectors captured.")}

### Variable (differ per purchase — for reference only)

${renderTable(variable, "No variable selectors captured.")}

## Learnings & gotchas

${record.learnings ?? "_No narration available for this run._"}

## Metadata

- **domain:** ${record.domain}
- **version:** ${record.version}
- **successCount:** ${record.successCount}
- **createdAt:** ${record.createdAt}
- **lastVerifiedAt:** ${record.lastVerifiedAt}
`;
}
