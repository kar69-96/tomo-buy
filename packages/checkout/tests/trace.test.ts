import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Page } from "playwright";
import { CheckoutTracer, makeTracerFromEnv } from "../src/trace.js";

let dir: string;

// A fake Page whose screenshot() writes a stub file at the requested path.
function fakePage(): Page {
  return {
    screenshot: async ({ path: p }: { path: string }) => {
      fs.writeFileSync(p, "PNGDATA");
      return Buffer.from("PNGDATA");
    },
  } as unknown as Page;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tomo-trace-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.CHECKOUT_TRACE_DIR;
});

describe("CheckoutTracer", () => {
  it("writes a manifest, screenshots, and JSONL records", async () => {
    const tracer = new CheckoutTracer(dir, "sess_test");
    const page = fakePage();

    const shot = await tracer.snapshot(page, "0-product");
    expect(shot).toBe("000-0-product.png");
    expect(fs.existsSync(path.join(dir, shot!))).toBe(true);

    tracer.record({
      pageIndex: 0,
      url: "https://shop.example/p/1",
      pageType: "product",
      action: "scripted:add-to-cart",
      mode: "scripted",
      advanced: true,
      screenshot: shot,
    });
    tracer.record({
      pageIndex: 1,
      url: "https://shop.example/checkout",
      pageType: "payment-form",
      action: "parked-before-place-order",
      mode: "navigate",
      outcome: "pass",
    });

    expect(tracer.recordCount).toBe(2);

    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf-8"));
    expect(manifest.sessionId).toBe("sess_test");

    const lines = fs
      .readFileSync(path.join(dir, "trace.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].action).toBe("scripted:add-to-cart");
    expect(lines[0].ts).toBeTruthy();
    expect(lines[0].step).toBe("navigate"); // default from the wrapped StepTracker
    expect(lines[1].pageType).toBe("payment-form");
    expect(lines[1].outcome).toBe("pass");
  });

  it("makeTracerFromEnv returns undefined when CHECKOUT_TRACE_DIR is unset", () => {
    delete process.env.CHECKOUT_TRACE_DIR;
    expect(makeTracerFromEnv("s")).toBeUndefined();
  });

  it("makeTracerFromEnv builds a tracer when CHECKOUT_TRACE_DIR is set", () => {
    process.env.CHECKOUT_TRACE_DIR = dir;
    const t = makeTracerFromEnv("s");
    expect(t).toBeInstanceOf(CheckoutTracer);
  });
});
