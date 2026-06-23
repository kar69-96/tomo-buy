import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  isSafeCookie,
  extractDomain,
  loadDomainCache,
  saveDomainCache,
} from "../src/cache.js";
import type { DomainCache } from "@bloon/core";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bloon-cache-test-"));
  process.env.BLOON_DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.BLOON_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("isSafeCookie", () => {
  it("returns true for safe cookie names", () => {
    expect(isSafeCookie("consent_cookie")).toBe(true);
    expect(isSafeCookie("language")).toBe(true);
    expect(isSafeCookie("cart_id")).toBe(true);
    expect(isSafeCookie("_ga")).toBe(true);
  });

  it("returns false for unsafe cookie names", () => {
    expect(isSafeCookie("session_id")).toBe(false);
    expect(isSafeCookie("auth_token")).toBe(false);
    expect(isSafeCookie("csrf_token")).toBe(false);
    expect(isSafeCookie("JSESSIONID")).toBe(false);
    expect(isSafeCookie("login_state")).toBe(false);
    expect(isSafeCookie("jwt_access")).toBe(false);
    expect(isSafeCookie("user_sid")).toBe(false);
  });
});

describe("extractDomain", () => {
  it("extracts domain from URL", () => {
    expect(extractDomain("https://example.com/path")).toBe("example.com");
  });

  it("strips www. prefix", () => {
    expect(extractDomain("https://www.example.com/path")).toBe("example.com");
  });

  it("handles URLs with ports and paths", () => {
    expect(extractDomain("https://shop.example.com:8080/products/123")).toBe(
      "shop.example.com",
    );
  });

  it("returns input for invalid URLs", () => {
    expect(extractDomain("not-a-url")).toBe("not-a-url");
  });
});

describe("loadDomainCache / saveDomainCache", () => {
  const testCache: DomainCache = {
    domain: "example.com",
    cookies: [
      {
        name: "cart_id",
        value: "abc123",
        domain: ".example.com",
        path: "/",
        expires: Date.now() / 1000 + 86400,
      },
    ],
    localStorage: { theme: "dark" },
    updated_at: new Date().toISOString(),
  };

  it("round-trips cache data", () => {
    saveDomainCache(testCache);
    const loaded = loadDomainCache("example.com");
    expect(loaded).toEqual(testCache);
  });

  it("returns null for missing cache", () => {
    const loaded = loadDomainCache("nonexistent.com");
    expect(loaded).toBeNull();
  });

  it("creates cache file with 0o600 permissions", () => {
    saveDomainCache(testCache);
    const filepath = path.join(tmpDir, "cache", "example.com.json");
    expect(fs.existsSync(filepath)).toBe(true);
    const stats = fs.statSync(filepath);
    // Check owner read/write only (0o600 = 384 decimal)
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it("overwrites existing cache", () => {
    saveDomainCache(testCache);
    const updated = { ...testCache, cookies: [], updated_at: new Date().toISOString() };
    saveDomainCache(updated);
    const loaded = loadDomainCache("example.com");
    expect(loaded?.cookies).toEqual([]);
  });
});
