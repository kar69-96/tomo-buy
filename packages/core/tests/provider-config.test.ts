import { describe, it, expect, afterEach } from "vitest";
import {
  getBrowserRuntime,
  getLlmProvider,
  getBrowserBackend,
  getAgentRunTimeoutMs,
} from "../src/config.js";

// Save/restore the env vars these accessors read so tests stay isolated.
const KEYS = [
  "BROWSER_RUNTIME",
  "BROWSERBASE_API_KEY",
  "LLM_PROVIDER",
  "GEMINI_API_KEY",
  "BROWSER_BACKEND",
  "AGENT_RUN_TIMEOUT_MS",
] as const;

const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function clear() {
  for (const k of KEYS) delete process.env[k];
}

describe("getBrowserRuntime", () => {
  it("defaults to local", () => {
    clear();
    expect(getBrowserRuntime()).toBe("local");
  });

  it("stays local when browserbase is requested but no key is set", () => {
    clear();
    process.env.BROWSER_RUNTIME = "browserbase";
    expect(getBrowserRuntime()).toBe("local");
  });

  it("switches to browserbase only with both flag and key", () => {
    clear();
    process.env.BROWSER_RUNTIME = "browserbase";
    process.env.BROWSERBASE_API_KEY = "bb_test";
    expect(getBrowserRuntime()).toBe("browserbase");
  });
});

describe("getLlmProvider", () => {
  it("defaults to openrouter", () => {
    clear();
    expect(getLlmProvider()).toBe("openrouter");
  });

  it("stays openrouter when gemini is requested but no key is set", () => {
    clear();
    process.env.LLM_PROVIDER = "gemini";
    expect(getLlmProvider()).toBe("openrouter");
  });

  it("switches to gemini only with both flag and key", () => {
    clear();
    process.env.LLM_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "AItest";
    expect(getLlmProvider()).toBe("gemini");
  });
});

describe("getBrowserBackend", () => {
  it("defaults to local", () => {
    clear();
    expect(getBrowserBackend()).toBe("local");
  });

  it("stays local when browserbase-agents is requested but no key is set", () => {
    clear();
    process.env.BROWSER_BACKEND = "browserbase-agents";
    expect(getBrowserBackend()).toBe("local");
  });

  it("switches to browserbase-agents only with both flag and key", () => {
    clear();
    process.env.BROWSER_BACKEND = "browserbase-agents";
    process.env.BROWSERBASE_API_KEY = "bb_test";
    expect(getBrowserBackend()).toBe("browserbase-agents");
  });
});

describe("getAgentRunTimeoutMs", () => {
  it("defaults to 5 minutes", () => {
    clear();
    expect(getAgentRunTimeoutMs()).toBe(300_000);
  });

  it("honors a positive override", () => {
    clear();
    process.env.AGENT_RUN_TIMEOUT_MS = "60000";
    expect(getAgentRunTimeoutMs()).toBe(60_000);
  });

  it("ignores a non-positive/invalid override", () => {
    clear();
    process.env.AGENT_RUN_TIMEOUT_MS = "-5";
    expect(getAgentRunTimeoutMs()).toBe(300_000);
    process.env.AGENT_RUN_TIMEOUT_MS = "abc";
    expect(getAgentRunTimeoutMs()).toBe(300_000);
  });
});
