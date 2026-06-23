import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  putSecret,
  getSecret,
  hasSecret,
  removeSecret,
  generatePassword,
} from "../src/vault.js";

let dir: string;
const origDataDir = process.env.TOMO_DATA_DIR;
const origKey = process.env.VAULT_KEY;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tomo-vault-"));
  process.env.TOMO_DATA_DIR = dir;
  process.env.VAULT_KEY = "test-vault-key-123";
});

afterAll(() => {
  if (origDataDir === undefined) delete process.env.TOMO_DATA_DIR;
  else process.env.TOMO_DATA_DIR = origDataDir;
  if (origKey === undefined) delete process.env.VAULT_KEY;
  else process.env.VAULT_KEY = origKey;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("vault", () => {
  it("round-trips an encrypted secret", async () => {
    const ref = await putSecret("hunter2-the-password");
    expect(ref).toMatch(/^vault_/);
    expect(getSecret(ref)).toBe("hunter2-the-password");
  });

  it("stores ciphertext at rest (not plaintext)", async () => {
    const ref = await putSecret("super-secret-token");
    const raw = fs.readFileSync(path.join(dir, "vault.json"), "utf-8");
    expect(raw).not.toContain("super-secret-token");
    expect(hasSecret(ref)).toBe(true);
  });

  it("removes a secret", async () => {
    const ref = await putSecret("temp");
    await removeSecret(ref);
    expect(hasSecret(ref)).toBe(false);
  });

  it("throws VAULT_LOCKED when the key is unset", () => {
    const saved = process.env.VAULT_KEY;
    delete process.env.VAULT_KEY;
    try {
      expect(() => putSecret("x")).toThrow(/VAULT_KEY/);
      expect(() => getSecret("vault_whatever")).toThrow(/VAULT_KEY/);
    } finally {
      process.env.VAULT_KEY = saved;
    }
  });

  it("generates a non-trivial password", () => {
    const pw = generatePassword();
    expect(pw.length).toBeGreaterThanOrEqual(18);
    expect(pw).not.toBe(generatePassword());
  });
});
