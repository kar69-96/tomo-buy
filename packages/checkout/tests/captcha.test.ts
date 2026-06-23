import { describe, it, expect, vi } from "vitest";
import { waitForCaptchaSolve } from "../src/captcha.js";

// ---- Mock Page ----

function createMockPage(options: {
  evaluateResults?: unknown[];
  url?: string;
}) {
  let callCount = 0;
  const urls = [options.url ?? "https://example.com"];

  return {
    evaluate: vi.fn(async () => {
      const results = options.evaluateResults ?? [false];
      const result = results[Math.min(callCount, results.length - 1)];
      callCount++;
      return result;
    }),
    url: vi.fn(() => urls[urls.length - 1]!),
    waitForTimeout: vi.fn(async () => {}),
    waitForLoadState: vi.fn(async () => {}),
  };
}

describe("waitForCaptchaSolve", () => {
  it("returns immediately when no challenge is detected", async () => {
    const page = createMockPage({ evaluateResults: [false] });
    await waitForCaptchaSolve(page as never, 5000);
    // Should only call evaluate once (the initial check)
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it("polls until challenge is resolved", async () => {
    // First call: challenge detected (true)
    // Second call: still detected (true from poll)
    // Third call: resolved (false from poll → true from evaluate since it means no challenge)
    const page = createMockPage({ evaluateResults: [true, false, true] });
    await waitForCaptchaSolve(page as never, 5000);
    // Initial check + at least one poll iteration
    expect(page.evaluate.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("stops polling on timeout", async () => {
    // Challenge never resolves
    const page = createMockPage({ evaluateResults: [true, false, false, false] });
    const start = Date.now();
    await waitForCaptchaSolve(page as never, 100);
    const elapsed = Date.now() - start;
    // Should not run for more than timeout + small buffer
    expect(elapsed).toBeLessThan(3000);
  });

  it("handles evaluate errors gracefully", async () => {
    const page = createMockPage({});
    page.evaluate = vi.fn(async () => { throw new Error("Page crashed"); });
    // Should not throw
    await waitForCaptchaSolve(page as never, 1000);
  });
});
