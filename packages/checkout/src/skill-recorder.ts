/**
 * SkillRecorder — always-on, in-memory collector for a single checkout run.
 *
 * Distinct from CheckoutTracer (trace.ts), which is opt-in (gated on
 * CHECKOUT_TRACE_DIR), writes JSONL + screenshots, and records prose actions for
 * human debugging. The recorder is always on, holds only structured selector
 * records in memory, and its sole output is the committed site skill written on
 * success. Both can be fed from the same hook points in task.ts.
 *
 * It owns its own arrays; `finalize()` returns a fresh frozen record and never
 * mutates anything the caller passed in. By construction it can only ever hold
 * field labels + selectors — never a field value (see skill-types.ts).
 */
import {
  type RecordedSelector,
  type PageFlowEntry,
  type SiteSkillRecord,
  type SkillMode,
  SITE_SKILL_SCHEMA,
} from "./skill-types.js";

/** Strip query string + hash so order tokens / session ids never get recorded. */
function safePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || "/";
  } catch {
    // Best-effort: drop everything after the first `?` or `#`.
    return url.split(/[?#]/)[0] || url;
  }
}

function selectorKey(s: RecordedSelector): string {
  return `${s.pageType}|${s.action}|${s.fieldLabel}|${s.matchedSelector}`;
}

/** Dedupe selectors on (pageType, action, fieldLabel, matchedSelector), order-preserving. */
export function dedupeSelectors(
  selectors: readonly RecordedSelector[],
): RecordedSelector[] {
  const seen = new Set<string>();
  const out: RecordedSelector[] = [];
  for (const s of selectors) {
    const key = selectorKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Collapse consecutive duplicate page-types into a single flow entry. */
export function dedupeFlow(flow: readonly PageFlowEntry[]): PageFlowEntry[] {
  const out: PageFlowEntry[] = [];
  for (const entry of flow) {
    const prev = out[out.length - 1];
    if (prev && prev.pageType === entry.pageType && prev.urlPath === entry.urlPath) {
      continue;
    }
    out.push(entry);
  }
  return out;
}

export class SkillRecorder {
  private readonly domain: string;
  private readonly selectors: RecordedSelector[] = [];
  private readonly flow: PageFlowEntry[] = [];

  constructor(domain: string) {
    this.domain = domain;
  }

  /** Record entry to a page. Call once per loop iteration. */
  observePage(index: number, pageType: PageFlowEntry["pageType"], url: string): void {
    this.flow.push({ index, pageType, urlPath: safePath(url) });
  }

  /**
   * Record a selector that matched. `entry` carries only a label + selector —
   * there is no value parameter, so a secret value cannot be recorded.
   */
  recordSelector(entry: Omit<RecordedSelector, "mode">, mode: SkillMode = "scripted"): void {
    this.selectors.push({ ...entry, mode });
  }

  /** Number of selectors captured so far (used to gate the write — see task.ts). */
  get selectorCount(): number {
    return this.selectors.length;
  }

  /** Build the immutable skill record for this run. Returns a fresh frozen object. */
  finalize(now: Date = new Date()): SiteSkillRecord {
    const iso = now.toISOString();
    return Object.freeze({
      domain: this.domain,
      version: 1,
      successCount: 1,
      createdAt: iso,
      lastVerifiedAt: iso,
      pageFlow: dedupeFlow(this.flow),
      selectors: dedupeSelectors(this.selectors),
      schema: SITE_SKILL_SCHEMA,
    });
  }
}
