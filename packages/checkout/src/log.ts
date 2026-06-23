/**
 * Per-run console capture for checkout.
 *
 * Tees `console.{log,info,warn,error}` into a `run.log` file inside the active
 * trace dir, each line prefixed with elapsed seconds since the run started — so a
 * run's full narrative is saved next to `trace.jsonl` instead of only scrolling
 * past on stdout. It mirrors exactly what the code already prints (which is
 * secret-safe by construction — card/login secrets never reach a console call),
 * so the file is safe to keep and share.
 *
 * Returns a handle whose `stop()` restores the original console methods. ALWAYS
 * call `stop()` (e.g. in a `finally`) so the wrapper never leaks across runs or
 * tests. It composes with an outer wrapper (e.g. the e2e harness's console.log
 * capture): the original method is still invoked, so stdout and any outer hook
 * keep working.
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";

type Method = "log" | "info" | "warn" | "error";
const METHODS: readonly Method[] = ["log", "info", "warn", "error"];
const TAG: Record<Method, string> = { log: "", info: "", warn: "WARN ", error: "ERROR " };

export interface ConsoleTee {
  /** Restore the original console methods. Idempotent. */
  stop(): void;
}

/** Render console args to a single line, JSON-encoding non-strings. */
function render(args: readonly unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

/**
 * Start mirroring console output to `<dir>/run.log`. `startMs` is the run's
 * start timestamp (Date.now()) used to compute the elapsed prefix.
 */
export function teeConsoleToFile(dir: string, startMs: number): ConsoleTee {
  const file = join(dir, "run.log");
  const saved = {} as Record<Method, (...args: unknown[]) => void>;

  for (const m of METHODS) {
    // Save the raw reference (no bind) so stop() restores the exact original.
    const prev = console[m] as (...args: unknown[]) => void;
    saved[m] = prev;
    console[m] = (...args: unknown[]) => {
      prev.apply(console, args); // preserve stdout + any outer wrapper
      try {
        const t = ((Date.now() - startMs) / 1000).toFixed(1);
        appendFileSync(file, `[+${t}s] ${TAG[m]}${render(args)}\n`);
      } catch {
        /* logging must never break a run */
      }
    };
  }

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      for (const m of METHODS) console[m] = saved[m];
    },
  };
}
