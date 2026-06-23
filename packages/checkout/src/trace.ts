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
}

export class CheckoutTracer {
  private readonly dir: string;
  private readonly tracker = new StepTracker();
  private shotSeq = 0;
  private recSeq = 0;

  constructor(dir: string, sessionId: string) {
    this.dir = dir;
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
    const full: TraceRecord = {
      ts: rec.ts ?? new Date().toISOString(),
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
    };
    this.recSeq++;
    try {
      appendFileSync(join(this.dir, "trace.jsonl"), JSON.stringify(full) + "\n");
    } catch {
      /* best-effort: tracing must never break checkout */
    }
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
