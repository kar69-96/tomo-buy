import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { teeConsoleToFile } from "../src/log.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tomo-log-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("teeConsoleToFile", () => {
  it("mirrors console output to run.log with elapsed prefixes, then restores", () => {
    const original = console.log;
    const tee = teeConsoleToFile(dir, Date.now());
    // While active, console.log is wrapped.
    expect(console.log).not.toBe(original);

    console.log("  [page 0] type=product");
    console.warn("careful");
    console.error("boom");

    tee.stop();
    // After stop(), the original method is restored.
    expect(console.log).toBe(original);

    const logText = fs.readFileSync(path.join(dir, "run.log"), "utf-8");
    expect(logText).toContain("[page 0] type=product");
    expect(logText).toMatch(/\[\+\d+\.\d+s\]/); // elapsed prefix
    expect(logText).toContain("WARN careful");
    expect(logText).toContain("ERROR boom");
  });

  it("still calls the original console (composes with an outer wrapper)", () => {
    const seen: string[] = [];
    const original = console.log;
    console.log = (...a: unknown[]) => seen.push(a.join(" "));
    try {
      const tee = teeConsoleToFile(dir, Date.now());
      console.log("hello");
      tee.stop();
      expect(seen).toContain("hello"); // outer wrapper still received it
    } finally {
      console.log = original;
    }
  });

  it("stop() is idempotent", () => {
    const original = console.log;
    const tee = teeConsoleToFile(dir, Date.now());
    tee.stop();
    tee.stop();
    expect(console.log).toBe(original);
  });

  it("JSON-encodes non-string args", () => {
    const tee = teeConsoleToFile(dir, Date.now());
    console.log("obj", { a: 1 });
    tee.stop();
    const logText = fs.readFileSync(path.join(dir, "run.log"), "utf-8");
    expect(logText).toContain('obj {"a":1}');
  });
});
