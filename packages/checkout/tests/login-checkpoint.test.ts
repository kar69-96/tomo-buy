import { describe, it, expect } from "vitest";
import { shouldParkAfterLogin } from "../src/task.js";

/**
 * The login-checkpoint park decision is generic: it parks ONLY when a checkpoint
 * run was requested AND the login executor actually advanced the form. A run that
 * never finds a login form (advanced=false) must fall through to the normal flow,
 * so it isn't keyed on any site — only on the executor's advance signal.
 */
describe("shouldParkAfterLogin", () => {
  it("parks when a checkpoint run logged in successfully", () => {
    expect(shouldParkAfterLogin(true, true)).toBe(true);
  });

  it("does not park when login did not advance", () => {
    // e.g. no login form on the page, or the form couldn't be completed.
    expect(shouldParkAfterLogin(true, false)).toBe(false);
  });

  it("never parks when checkpoint mode is off", () => {
    expect(shouldParkAfterLogin(false, true)).toBe(false);
    expect(shouldParkAfterLogin(undefined, true)).toBe(false);
    expect(shouldParkAfterLogin(undefined, false)).toBe(false);
  });
});
