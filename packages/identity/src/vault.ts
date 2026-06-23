/**
 * Local encrypted secret vault (~/.tomo/vault.json).
 *
 * SECURITY: stores login passwords and session tokens at rest, encrypted with
 * AES-256-GCM under a key derived from VAULT_KEY. Plaintext secrets are returned
 * ONLY to the login/CDP fill path — they are never logged and never handed to
 * the LLM (the model only ever sees the email/username). This mirrors the
 * card-data trust boundary in packages/checkout/src/credentials.ts.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { TomoError, ErrorCodes, getVaultKey } from "@tomo/core";

interface VaultEntry {
  salt: string; // hex
  iv: string; // hex
  tag: string; // hex
  data: string; // hex ciphertext
}

type VaultFile = Record<string, VaultEntry>;

const VAULT_FILE = "vault.json";

function getDataDir(): string {
  return process.env.TOMO_DATA_DIR || path.join(os.homedir(), ".tomo");
}

function vaultPath(): string {
  return path.join(getDataDir(), VAULT_FILE);
}

function readVault(): VaultFile {
  try {
    return JSON.parse(fs.readFileSync(vaultPath(), "utf-8")) as VaultFile;
  } catch {
    return {};
  }
}

function writeVault(vault: VaultFile): void {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = vaultPath() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(vault, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, vaultPath());
}

function requireKey(): string {
  const key = getVaultKey();
  if (!key) {
    throw new TomoError(
      ErrorCodes.VAULT_LOCKED,
      "VAULT_KEY is not set — cannot read or write the secret vault.",
    );
  }
  return key;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, 32);
}

// ---- Write serialization ----

let queue: Promise<void> = Promise.resolve();

function generateRef(): string {
  return `vault_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Encrypt and store a secret. Returns the opaque ref to persist on the
 * identity/account record (never store the plaintext there).
 */
export function putSecret(value: string, ref?: string): Promise<string> {
  const key = requireKey();
  const id = ref ?? generateRef();
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(key, salt), iv);
  const data = Buffer.concat([cipher.update(value, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  queue = queue.then(() => {
    const vault = readVault();
    vault[id] = {
      salt: salt.toString("hex"),
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      data: data.toString("hex"),
    };
    writeVault(vault);
  });
  return queue.then(() => id);
}

/** Decrypt and return a secret. Throws VAULT_LOCKED if the ref is unknown. */
export function getSecret(ref: string): string {
  const key = requireKey();
  const entry = readVault()[ref];
  if (!entry) {
    throw new TomoError(
      ErrorCodes.VAULT_LOCKED,
      `No vault entry for ref ${ref}.`,
    );
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    deriveKey(key, Buffer.from(entry.salt, "hex")),
    Buffer.from(entry.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(entry.tag, "hex"));
  const out = Buffer.concat([
    decipher.update(Buffer.from(entry.data, "hex")),
    decipher.final(),
  ]);
  return out.toString("utf-8");
}

export function hasSecret(ref: string): boolean {
  return ref in readVault();
}

export function removeSecret(ref: string): Promise<void> {
  queue = queue.then(() => {
    const vault = readVault();
    delete vault[ref];
    writeVault(vault);
  });
  return queue;
}

/** Generate a strong random password for a new agent site account. */
export function generatePassword(): string {
  // 18 url-safe chars + guaranteed symbol/case/digit mix for signup forms.
  const base = crypto.randomBytes(18).toString("base64url").slice(0, 18);
  return `A${base}9!`;
}
