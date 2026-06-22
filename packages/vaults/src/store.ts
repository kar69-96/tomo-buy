import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EncryptedBlob } from './crypto.js';

/**
 * Persistence boundary for vault records. Records are stored already-encrypted
 * (AES-256-GCM blobs from crypto.ts) — the store never sees plaintext, so even
 * the local-dev file path holds nothing readable.
 *
 * The production target is a KMS-encrypted Postgres adapter; it implements this
 * same interface and is a documented follow-up (see phase-03 report). The two
 * implementations here cover tests (InMemoryStore) and local dev
 * (EncryptedFileStore, env-selected).
 */
export interface VaultStore {
  get(key: string): Promise<EncryptedBlob | undefined>;
  put(key: string, blob: EncryptedBlob): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  /** Delete every record whose key starts with `prefix`. Returns count removed. */
  deletePrefix(prefix: string): Promise<number>;
  keys(): Promise<string[]>;
}

/** In-memory store. Used by tests and ephemeral runs. */
export class InMemoryStore implements VaultStore {
  private readonly map = new Map<string, EncryptedBlob>();

  async get(key: string): Promise<EncryptedBlob | undefined> {
    return this.map.get(key);
  }

  async put(key: string, blob: EncryptedBlob): Promise<void> {
    this.map.set(key, blob);
  }

  async has(key: string): Promise<boolean> {
    return this.map.has(key);
  }

  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }

  async deletePrefix(prefix: string): Promise<number> {
    let removed = 0;
    for (const key of [...this.map.keys()]) {
      if (key.startsWith(prefix)) {
        this.map.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
}

/**
 * Local-dev store backed by a JSON file (mode 0o600). The values written are the
 * encrypted blobs only — no plaintext ever touches disk. The whole map is read
 * and rewritten on each mutation (fine for local dev volumes).
 */
export class EncryptedFileStore implements VaultStore {
  constructor(private readonly filePath: string) {}

  private read(): Record<string, EncryptedBlob> {
    if (!existsSync(this.filePath)) return {};
    const raw = readFileSync(this.filePath, 'utf8');
    return JSON.parse(raw) as Record<string, EncryptedBlob>;
  }

  private write(map: Record<string, EncryptedBlob>): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(map, null, 2), { mode: 0o600 });
  }

  async get(key: string): Promise<EncryptedBlob | undefined> {
    return this.read()[key];
  }

  async put(key: string, blob: EncryptedBlob): Promise<void> {
    const map = this.read();
    this.write({ ...map, [key]: blob });
  }

  async has(key: string): Promise<boolean> {
    return Object.prototype.hasOwnProperty.call(this.read(), key);
  }

  async delete(key: string): Promise<boolean> {
    const map = this.read();
    if (!Object.prototype.hasOwnProperty.call(map, key)) return false;
    const { [key]: _removed, ...rest } = map;
    this.write(rest);
    return true;
  }

  async deletePrefix(prefix: string): Promise<number> {
    const map = this.read();
    const next: Record<string, EncryptedBlob> = {};
    let removed = 0;
    for (const [key, blob] of Object.entries(map)) {
      if (key.startsWith(prefix)) removed += 1;
      else next[key] = blob;
    }
    if (removed > 0) this.write(next);
    return removed;
  }

  async keys(): Promise<string[]> {
    return Object.keys(this.read());
  }
}

/**
 * Choose a store from environment. Local dev / tests get an encrypted file when
 * `VAULT_STORE_FILE` is set, otherwise an in-memory store. The production
 * KMS+Postgres adapter (same interface) is wired in a later phase.
 */
export function selectStore(env: NodeJS.ProcessEnv = process.env): VaultStore {
  const file = env.VAULT_STORE_FILE;
  return file ? new EncryptedFileStore(file) : new InMemoryStore();
}
