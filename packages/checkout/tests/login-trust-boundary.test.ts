import { describe, it, expect } from "vitest";
import { isCdpField, getStagehandVariables } from "../src/credentials.js";

/**
 * The login secrets (password, session token) must follow the same trust
 * boundary as card data: never exposed to the LLM (Stagehand variables).
 */
describe("login secret trust boundary", () => {
  it("treats login password and session token as CDP-only fields", () => {
    expect(isCdpField("x_login_password")).toBe(true);
    expect(isCdpField("x_session_token")).toBe(true);
    // email/username is LLM-safe (typed as a %var%)
    expect(isCdpField("x_login_email")).toBe(false);
  });

  it("never leaks login secrets into the Stagehand variable map", () => {
    const creds = {
      x_login_email: "agent@tomo.local",
      x_login_password: "should-never-reach-llm",
      x_session_token: "tok-should-never-reach-llm",
      x_shipping_name: "Jane Doe",
    } as unknown as import("@tomo/core").CredentialsMap;

    const vars = getStagehandVariables(creds);
    const serialized = JSON.stringify(vars);
    expect(serialized).not.toContain("should-never-reach-llm");
    expect(serialized).not.toContain("tok-should-never-reach-llm");
    expect(vars.x_login_email).toBe("agent@tomo.local");
  });
});
