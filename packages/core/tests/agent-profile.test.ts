import { describe, it, expect, afterEach } from "vitest";
import { getAgentProfile } from "../src/config.js";

// Save/restore the env vars this accessor reads so tests stay isolated.
const KEYS = ["AGENT_NAME", "AGENT_PHONE"] as const;

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

describe("getAgentProfile", () => {
  it("defaults to a neutral persona name and empty phone", () => {
    clear();
    expect(getAgentProfile()).toEqual({ name: "Tomo Shopper", phone: "" });
  });

  it("reads AGENT_NAME and AGENT_PHONE from env", () => {
    clear();
    process.env.AGENT_NAME = "Ada Lovelace";
    process.env.AGENT_PHONE = "(415) 555-0142";
    expect(getAgentProfile()).toEqual({
      name: "Ada Lovelace",
      phone: "(415) 555-0142",
    });
  });
});
