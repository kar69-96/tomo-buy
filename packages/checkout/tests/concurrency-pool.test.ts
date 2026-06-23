import { describe, it, expect } from "vitest";
import { concurrencyPool } from "../src/concurrency-pool.js";

// Re-export tests: verify checkout's concurrency-pool re-exports from @bloon/core
describe("concurrencyPool (re-export from @bloon/core)", () => {
  it("re-exports and works correctly", async () => {
    const results = await concurrencyPool([1, 2], async (n) => n * 2, 2);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ status: "fulfilled", value: 2 });
    expect(results[1]).toEqual({ status: "fulfilled", value: 4 });
  });
});
