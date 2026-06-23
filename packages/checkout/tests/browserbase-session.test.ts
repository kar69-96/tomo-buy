import { describe, it, expect } from "vitest";
import {
  buildSessionRequest,
  replayUrlFor,
} from "../src/browserbase-session.js";

describe("buildSessionRequest", () => {
  it("defaults stealth + proxies on (production stealth mode)", () => {
    const body = buildSessionRequest("proj_123");
    expect(body.projectId).toBe("proj_123");
    expect(body.proxies).toBe(true);
    expect((body.browserSettings as { advancedStealth: boolean }).advancedStealth).toBe(true);
  });

  it("honors explicit stealth/proxies overrides", () => {
    const body = buildSessionRequest("proj_123", { stealth: false, proxies: false });
    expect(body.proxies).toBe(false);
    expect((body.browserSettings as { advancedStealth: boolean }).advancedStealth).toBe(false);
  });
});

describe("replayUrlFor", () => {
  it("builds the session-inspector URL", () => {
    expect(replayUrlFor("sess_abc")).toBe(
      "https://www.browserbase.com/sessions/sess_abc",
    );
  });
});
