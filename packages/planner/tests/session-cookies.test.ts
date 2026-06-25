import { describe, it, expect } from "vitest";
import { parseSessionCookies } from "../src/run.js";

describe("parseSessionCookies()", () => {
  it("parses a JSON array into the full cookie set", () => {
    const json = JSON.stringify([
      { name: "auth", value: "a1", domain: ".flyfrontier.com", path: "/" },
      { name: "sess", value: "s2" },
    ]);
    const cookies = parseSessionCookies(json, "flyfrontier.com");
    expect(cookies).toEqual([
      { name: "auth", value: "a1", domain: ".flyfrontier.com", path: "/" },
      { name: "sess", value: "s2", domain: "flyfrontier.com", path: "/" },
    ]);
  });

  it("falls back to a single cookie for a bare token string", () => {
    const cookies = parseSessionCookies("rawtoken123", "shop.test", "sid");
    expect(cookies).toEqual([{ name: "sid", value: "rawtoken123", domain: "shop.test" }]);
  });

  it("uses the default cookie name when none provided for a bare token", () => {
    expect(parseSessionCookies("tok", "shop.test")).toEqual([
      { name: "session", value: "tok", domain: "shop.test" },
    ]);
  });

  it("drops malformed cookie entries (missing name/value)", () => {
    const json = JSON.stringify([{ name: "ok", value: "v" }, { name: "bad" }, { value: "novalue" }]);
    const cookies = parseSessionCookies(json, "shop.test");
    expect(cookies).toEqual([{ name: "ok", value: "v", domain: "shop.test", path: "/" }]);
  });

  it("falls back to single-cookie when JSON is invalid", () => {
    const cookies = parseSessionCookies("[not json", "shop.test");
    expect(cookies).toEqual([{ name: "session", value: "[not json", domain: "shop.test" }]);
  });
});
