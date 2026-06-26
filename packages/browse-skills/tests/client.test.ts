import { describe, it, expect, afterEach } from "vitest";
import { isBrowseAvailable, extractJson } from "../src/client.js";

describe("isBrowseAvailable", () => {
  const orig = process.env.BROWSERBASE_API_KEY;
  afterEach(() => {
    if (orig === undefined) delete process.env.BROWSERBASE_API_KEY;
    else process.env.BROWSERBASE_API_KEY = orig;
  });

  it("returns false when BROWSERBASE_API_KEY is absent", () => {
    delete process.env.BROWSERBASE_API_KEY;
    expect(isBrowseAvailable()).toBe(false);
  });

  it("returns true when BROWSERBASE_API_KEY is present", () => {
    process.env.BROWSERBASE_API_KEY = "bb_test_key";
    expect(isBrowseAvailable()).toBe(true);
  });
});

describe("extractJson", () => {
  it("parses a JSON object embedded in log lines", () => {
    const out = 'Connecting...\nDone.\n{"products":[{"asin":"B001"}]}\n';
    expect(extractJson<{ products: unknown[] }>(out).products).toHaveLength(1);
  });

  it("parses a JSON array embedded in output", () => {
    const out = "loading...\n[1,2,3]\n";
    expect(extractJson<number[]>(out)).toEqual([1, 2, 3]);
  });

  it("throws when no JSON is present", () => {
    expect(() => extractJson("No JSON here")).toThrow("no JSON");
  });
});
