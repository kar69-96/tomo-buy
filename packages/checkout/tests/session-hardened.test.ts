import { describe, it, expect } from "vitest";
import { getAnthropicApiKey } from "../src/session.js";

describe("getAnthropicApiKey", () => {
  it("returns key when ANTHROPIC_API_KEY is set", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    try {
      expect(getAnthropicApiKey()).toBe("sk-ant-test-key");
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("throws when ANTHROPIC_API_KEY is missing", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => getAnthropicApiKey()).toThrow("ANTHROPIC_API_KEY");
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
