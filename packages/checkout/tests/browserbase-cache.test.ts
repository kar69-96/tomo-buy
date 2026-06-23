import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadContextId,
  saveContextId,
  loadContextMap,
  buildContextSetting,
} from "../src/browserbase-cache.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tomo-bb-cache-test-"));
  process.env.TOMO_DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.TOMO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("buildContextSetting", () => {
  it("defaults persist to true", () => {
    expect(buildContextSetting("ctx_123")).toEqual({
      id: "ctx_123",
      persist: true,
    });
  });

  it("respects an explicit persist=false", () => {
    expect(buildContextSetting("ctx_123", false)).toEqual({
      id: "ctx_123",
      persist: false,
    });
  });
});

describe("loadContextId / saveContextId", () => {
  it("returns null for an unmapped domain", () => {
    expect(loadContextId("example.com")).toBeNull();
  });

  it("round-trips a domain -> contextId association", () => {
    saveContextId("example.com", "ctx_abc");
    expect(loadContextId("example.com")).toBe("ctx_abc");
  });

  it("keeps separate context ids per domain", () => {
    saveContextId("example.com", "ctx_a");
    saveContextId("shop.test", "ctx_b");
    expect(loadContextMap()).toEqual({
      "example.com": "ctx_a",
      "shop.test": "ctx_b",
    });
  });

  it("overwrites the id for an existing domain without dropping others", () => {
    saveContextId("example.com", "ctx_old");
    saveContextId("shop.test", "ctx_keep");
    saveContextId("example.com", "ctx_new");
    expect(loadContextId("example.com")).toBe("ctx_new");
    expect(loadContextId("shop.test")).toBe("ctx_keep");
  });

  it("writes the map file with 0o600 permissions", () => {
    saveContextId("example.com", "ctx_abc");
    const filepath = path.join(tmpDir, "cache", "_browserbase-contexts.json");
    expect(fs.existsSync(filepath)).toBe(true);
    expect(fs.statSync(filepath).mode & 0o777).toBe(0o600);
  });

  it("treats a corrupt map file as empty", () => {
    const dir = path.join(tmpDir, "cache");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "_browserbase-contexts.json"), "not json{");
    expect(loadContextMap()).toEqual({});
    expect(loadContextId("example.com")).toBeNull();
  });
});
