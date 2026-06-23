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

  it("omits the context block when no contextId is given (fresh profile)", () => {
    const body = buildSessionRequest("proj_123");
    expect((body.browserSettings as Record<string, unknown>).context).toBeUndefined();
  });

  it("attaches a persistent per-domain Context when a contextId is given", () => {
    const body = buildSessionRequest("proj_123", undefined, "ctx_abc");
    expect((body.browserSettings as Record<string, unknown>).context).toEqual({
      id: "ctx_abc",
      persist: true,
    });
  });
});

describe("replayUrlFor", () => {
  it("builds the session-inspector URL", () => {
    expect(replayUrlFor("sess_abc")).toBe(
      "https://www.browserbase.com/sessions/sess_abc",
    );
  });
});
