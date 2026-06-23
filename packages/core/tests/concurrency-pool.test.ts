import { describe, it, expect } from "vitest";
import { concurrencyPool } from "../src/concurrency-pool.js";

describe("concurrencyPool", () => {
  it("processes all tasks and returns results in order", async () => {
    const tasks = [10, 20, 30];
    const results = await concurrencyPool(
      tasks,
      async (n) => n * 2,
      2,
    );

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ status: "fulfilled", value: 20 });
    expect(results[1]).toEqual({ status: "fulfilled", value: 40 });
    expect(results[2]).toEqual({ status: "fulfilled", value: 60 });
  });

  it("handles failures without aborting others", async () => {
    const tasks = ["ok", "fail", "ok2"];
    const results = await concurrencyPool(
      tasks,
      async (t) => {
        if (t === "fail") throw new Error("boom");
        return t.toUpperCase();
      },
      3,
    );

    expect(results[0]).toEqual({ status: "fulfilled", value: "OK" });
    expect(results[1]!.status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect(results[2]).toEqual({ status: "fulfilled", value: "OK2" });
  });

  it("respects concurrency limit", async () => {
    let running = 0;
    let maxRunning = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => i);

    await concurrencyPool(
      tasks,
      async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
      },
      3,
    );

    expect(maxRunning).toBeLessThanOrEqual(3);
    expect(maxRunning).toBeGreaterThan(0);
  });

  it("handles empty task list", async () => {
    const results = await concurrencyPool(
      [],
      async () => "never",
      5,
    );
    expect(results).toEqual([]);
  });

  it("handles concurrency greater than task count", async () => {
    const tasks = [1, 2];
    const results = await concurrencyPool(
      tasks,
      async (n) => n + 1,
      10,
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ status: "fulfilled", value: 2 });
    expect(results[1]).toEqual({ status: "fulfilled", value: 3 });
  });
});
