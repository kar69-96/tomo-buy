import type { CostBreakdown, CostEntry, SessionCostEntry } from "@bloon/core";

// ---- LLM pricing per token ----

const LLM_PRICING: Record<string, { input: number; output: number }> = {
  "google/gemini-2.5-flash": { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
  "google/gemini-2.0-flash": { input: 0.10 / 1_000_000, output: 0.40 / 1_000_000 },
};

const DEFAULT_PRICING = { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 };

// ---- Browserbase pricing ----

const BROWSERBASE_HOURLY_RATE = 0.12; // $/hr (Dev plan overage)

// ---- CostTracker ----

function tokenCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = LLM_PRICING[model] ?? DEFAULT_PRICING;
  return inputTokens * pricing.input + outputTokens * pricing.output;
}

function sessionCost(durationMs: number): number {
  return (durationMs / 3_600_000) * BROWSERBASE_HOURLY_RATE;
}

export class CostTracker {
  private llmCalls: CostEntry[] = [];
  private sessions: SessionCostEntry[] = [];

  addLLMCall(label: string, inputTokens: number, outputTokens: number, model: string, durationMs: number): void {
    const cost = tokenCost(model, inputTokens, outputTokens);
    this.llmCalls.push({ label, inputTokens, outputTokens, model, costUsd: cost, durationMs });
  }

  addSession(sessionId: string, durationMs: number): void {
    const cost = sessionCost(durationMs);
    this.sessions.push({ sessionId, durationMs, costUsd: cost });
  }

  getSummary(): CostBreakdown {
    let totalIn = 0;
    let totalOut = 0;
    let llmCost = 0;
    for (const c of this.llmCalls) {
      totalIn += c.inputTokens;
      totalOut += c.outputTokens;
      llmCost += c.costUsd;
    }

    let sessCost = 0;
    for (const s of this.sessions) {
      sessCost += s.costUsd;
    }

    return {
      llmCalls: this.llmCalls,
      sessions: this.sessions,
      totalInputTokens: totalIn,
      totalOutputTokens: totalOut,
      llmCostUsd: llmCost,
      sessionCostUsd: sessCost,
      totalCostUsd: llmCost + sessCost,
    };
  }

  printSummary(): void {
    const s = this.getSummary();
    const fmt = (n: number) => n.toLocaleString();
    const usd = (n: number) => `$${n.toFixed(4)}`;

    const lines: string[] = [];
    lines.push("┌─────────────────────────────────────────────────────────┐");
    lines.push("│              BLOON RUN COST BREAKDOWN                   │");
    lines.push("├───────────────────────┬──────────┬──────────┬───────────┤");
    lines.push("│ Operation             │ In Tokens│Out Tokens│ Est. $    │");
    lines.push("├───────────────────────┼──────────┼──────────┼───────────┤");

    for (const c of this.llmCalls) {
      const lbl = c.label.padEnd(21).slice(0, 21);
      const inp = fmt(c.inputTokens).padStart(8);
      const out = fmt(c.outputTokens).padStart(8);
      const cost = usd(c.costUsd).padStart(9);
      lines.push(`│ ${lbl} │ ${inp} │ ${out} │ ${cost} │`);
    }

    if (this.llmCalls.length > 0) {
      const lbl = "LLM TOTAL".padEnd(21);
      const inp = fmt(s.totalInputTokens).padStart(8);
      const out = fmt(s.totalOutputTokens).padStart(8);
      const cost = usd(s.llmCostUsd).padStart(9);
      lines.push("├───────────────────────┼──────────┼──────────┼───────────┤");
      lines.push(`│ ${lbl} │ ${inp} │ ${out} │ ${cost} │`);
    }

    if (this.sessions.length > 0) {
      lines.push("├───────────────────────┼──────────┴──────────┼───────────┤");
      for (const sess of this.sessions) {
        const lbl = "Browserbase".padEnd(21);
        const dur = formatDuration(sess.durationMs).padStart(19);
        const cost = usd(sess.costUsd).padStart(9);
        lines.push(`│ ${lbl} │ ${dur} │ ${cost} │`);
      }
    }

    lines.push("├───────────────────────┼─────────────────────┼───────────┤");
    const totalLbl = "TOTAL EST.".padEnd(21);
    const totalCost = usd(s.totalCostUsd).padStart(9);
    lines.push(`│ ${totalLbl} │                     │ ${totalCost} │`);
    lines.push("└───────────────────────┴─────────────────────┴───────────┘");

    console.log(lines.join("\n"));
  }
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}
