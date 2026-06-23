import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { complete } from "../src/llm.js";

const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "sk-test";
  delete process.env.LLM_PROVIDER; // ensure OpenRouter path, not Gemini
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("complete() request timeout", () => {
  it("aborts and throws a timeout error when the request hangs", async () => {
    // A fetch that never resolves on its own, but rejects when the signal aborts
    // (matching real fetch semantics).
    globalThis.fetch = ((_url: string, opts: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        opts.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as typeof fetch;

    await expect(
      complete([{ role: "user", content: "hi" }], { timeoutMs: 50 }),
    ).rejects.toThrow(/timed out after 50ms/);
  });

  it("returns content when the request resolves before the timeout", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "pong" } }] }),
    })) as unknown as typeof fetch;

    const out = await complete([{ role: "user", content: "ping" }], { timeoutMs: 5000 });
    expect(out).toBe("pong");
  });
});
