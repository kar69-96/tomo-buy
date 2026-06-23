/**
 * CheckoutTracer — observability for a real browser checkout run.
 *
 * Emits a JSONL step trace + a screenshot per page transition into a directory,
 * so a human can see exactly where a run succeeded or failed. Constructed ONLY
 * when `process.env.CHECKOUT_TRACE_DIR` is set (or a dir is passed explicitly),
 * so production checkout is untouched.
 *
 * It wraps the existing StepTracker for the canonical `step` field and never
 * records any secret — only page types, actions, public price strings, and the
 * resolved login strategy name.
 */
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import type { LoginStrategy } from "@tomo/core";
import { StepTracker } from "./step-tracker.js";
import type { CheckoutStep } from "./task.js";
import type { PageType } from "./scripted-actions.js";

export type TraceMode = "scripted" | "llm" | "login" | "navigate";

export interface TraceRecord {
  ts: string;
  pageIndex: number;
  url: string;
  pageType: PageType;
  step: CheckoutStep;
  /** Human-readable action, e.g. "scripted-click:checkout" | "llm-act:Fill the…". */
  action: string;
  mode: TraceMode;
  loginStrategy?: LoginStrategy;
  advanced?: boolean;
  stallCount?: number;
  llmCalls?: number;
  /** Relative screenshot filename written for this transition, if any. */
  screenshot?: string;
  note?: string;
  outcome?: "pass" | "fail";
  /** Milliseconds since the previous record (wall-clock time spent on this step). */
  durationMs?: number;
  /** Structured, secret-safe detail for this transition (e.g. observed totals). */
  details?: Record<string, unknown>;
}

/** End-of-run rollup written to summary.json — a scannable index over trace.jsonl. */
export interface TraceSummary {
  sessionId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  records: number;
  /** Highest page index reached (0-based) + 1 → number of distinct pages. */
  pages: number;
  llmCalls: number;
  loginStrategy?: LoginStrategy;
  finalUrl?: string;
  finalPageType?: PageType;
  finalStep?: CheckoutStep;
  /** Outcome of the last record that carried one ("pass" | "fail"). */
  outcome?: "pass" | "fail";
  /** Observed order total at the payment page, when captured. */
  observedTotal?: string;
}

export class CheckoutTracer {
  private readonly dir: string;
  private readonly sessionId: string;
  private readonly startedAt: string;
  private readonly startMs: number;
  private readonly tracker = new StepTracker();
  private shotSeq = 0;
  private recSeq = 0;
  /** Timestamp (ms) of the previous record, for per-step durations. */
  private lastRecordMs: number;
  // Accumulators rolled up into summary.json at the end of the run.
  private maxPageIndex = -1;
  private maxLlmCalls = 0;
  private lastUrl?: string;
  private lastPageType?: PageType;
  private lastStrategy?: LoginStrategy;
  private lastOutcome?: "pass" | "fail";
  private observedTotal?: string;

  constructor(dir: string, sessionId: string) {
    this.dir = dir;
    this.sessionId = sessionId;
    this.startMs = Date.now();
    this.lastRecordMs = this.startMs;
    this.startedAt = new Date(this.startMs).toISOString();
    mkdirSync(dir, { recursive: true });
    // Write a small manifest so the trace dir is self-describing.
    try {
      writeFileSync(
        join(dir, "manifest.json"),
        JSON.stringify({ sessionId, startedAt: new Date().toISOString() }, null, 2),
      );
    } catch {
      /* best-effort */
    }
  }

  get stepTracker(): StepTracker {
    return this.tracker;
  }

  /** Capture a screenshot; returns the relative filename (or undefined on failure). */
  async snapshot(page: Page, label: string): Promise<string | undefined> {
    const safe = label.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60);
    const name = `${String(this.shotSeq++).padStart(3, "0")}-${safe}.png`;
    try {
      await page.screenshot({ path: join(this.dir, name), fullPage: false });
      return name;
    } catch {
      return undefined;
    }
  }

  /** Append one record to trace.jsonl. Fills `ts` and `step` if omitted. */
  record(rec: Partial<TraceRecord> & Pick<TraceRecord, "pageIndex" | "url" | "pageType" | "action" | "mode">): void {
    const now = Date.now();
    const full: TraceRecord = {
      ts: rec.ts ?? new Date(now).toISOString(),
      step: rec.step ?? this.tracker.currentStep,
      pageIndex: rec.pageIndex,
      url: rec.url,
      pageType: rec.pageType,
      action: rec.action,
      mode: rec.mode,
      loginStrategy: rec.loginStrategy,
      advanced: rec.advanced,
      stallCount: rec.stallCount,
      llmCalls: rec.llmCalls,
      screenshot: rec.screenshot,
      note: rec.note,
      outcome: rec.outcome,
      durationMs: rec.durationMs ?? now - this.lastRecordMs,
      details: rec.details,
    };
    this.lastRecordMs = now;
    this.recSeq++;
    this.accumulate(full);
    try {
      appendFileSync(join(this.dir, "trace.jsonl"), JSON.stringify(full) + "\n");
    } catch {
      /* best-effort: tracing must never break checkout */
    }
  }

  /** Roll a record into the running summary state. */
  private accumulate(r: TraceRecord): void {
    if (r.pageIndex > this.maxPageIndex) this.maxPageIndex = r.pageIndex;
    if (typeof r.llmCalls === "number" && r.llmCalls > this.maxLlmCalls) this.maxLlmCalls = r.llmCalls;
    this.lastUrl = r.url;
    this.lastPageType = r.pageType;
    if (r.loginStrategy) this.lastStrategy = r.loginStrategy;
    if (r.outcome) this.lastOutcome = r.outcome;
    const total = r.details?.observed_total;
    if (typeof total === "string" && total) this.observedTotal = total;
  }

  /**
   * Write summary.json — a scannable rollup over the run. `extra` lets the caller
   * stamp the final, authoritative outcome (success/error/step) it knows at return
   * time; anything omitted falls back to what was accumulated from the records.
   */
  writeSummary(extra?: Partial<TraceSummary>): TraceSummary {
    const finishMs = Date.now();
    const summary: TraceSummary = {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      finishedAt: new Date(finishMs).toISOString(),
      durationMs: finishMs - this.startMs,
      records: this.recSeq,
      pages: this.maxPageIndex + 1,
      llmCalls: this.maxLlmCalls,
      loginStrategy: this.lastStrategy,
      finalUrl: this.lastUrl,
      finalPageType: this.lastPageType,
      finalStep: this.tracker.currentStep,
      outcome: this.lastOutcome,
      observedTotal: this.observedTotal,
      ...extra,
    };
    try {
      writeFileSync(join(this.dir, "summary.json"), JSON.stringify(summary, null, 2));
    } catch {
      /* best-effort */
    }
    return summary;
  }

  /** Count of records emitted so far (useful for tests/summaries). */
  get recordCount(): number {
    return this.recSeq;
  }
}

/** Build a tracer from env, or undefined when tracing is disabled. */
export function makeTracerFromEnv(sessionId: string): CheckoutTracer | undefined {
  const dir = process.env.CHECKOUT_TRACE_DIR;
  return dir ? new CheckoutTracer(dir, sessionId) : undefined;
}
