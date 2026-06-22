import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryStore, EncryptedFileStore, selectStore } from './store.js';
import { encrypt } from './crypto.js';

const blob = encrypt('value', 'pass');

function runStoreContract(name: string, make: () => { store: import('./store.js').VaultStore }) {
  describe(name, () => {
    it('put/get/has/delete roundtrip', async () => {
      const { store } = make();
      expect(await store.has('k')).toBe(false);
      await store.put('k', blob);
      expect(await store.has('k')).toBe(true);
      expect(await store.get('k')).toEqual(blob);
      expect(await store.delete('k')).toBe(true);
      expect(await store.delete('k')).toBe(false);
      expect(await store.get('k')).toBeUndefined();
    });

    it('deletePrefix removes only matching keys and reports count', async () => {
      const { store } = make();
      await store.put('b:u1:email', blob);
      await store.put('b:u1:zip', blob);
      await store.put('b:u2:email', blob);
      expect(await store.deletePrefix('b:u1:')).toBe(2);
      expect(await store.keys()).toEqual(['b:u2:email']);
      expect(await store.deletePrefix('nope:')).toBe(0);
    });
  });
}

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function newFileStore() {
  const dir = mkdtempSync(join(tmpdir(), 'vault-store-'));
  tmpDirs.push(dir);
  return { store: new EncryptedFileStore(join(dir, 'nested', 'vault.json')), dir };
}

runStoreContract('InMemoryStore', () => ({ store: new InMemoryStore() }));
runStoreContract('EncryptedFileStore', () => newFileStore());

describe('EncryptedFileStore on disk', () => {
  it('writes the file with 0o600 perms and only ciphertext (no plaintext)', async () => {
    const { store } = newFileStore();
    await store.put('b:u1:pan', encrypt('4111111111110042', 'pass'));
    const keys = await store.keys();
    // Re-derive the path via a fresh read of the same store instance.
    const filePath = (store as unknown as { filePath: string }).filePath;
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
    const raw = readFileSync(filePath, 'utf8');
    expect(raw).not.toContain('4111111111110042');
    expect(keys).toEqual(['b:u1:pan']);
  });

  it('returns undefined / empty when file does not exist yet', async () => {
    const { store } = newFileStore();
    expect(await store.get('missing')).toBeUndefined();
    expect(await store.has('missing')).toBe(false);
    expect(await store.keys()).toEqual([]);
  });
});

describe('selectStore', () => {
  it('returns an EncryptedFileStore when VAULT_STORE_FILE is set', () => {
    expect(selectStore({ VAULT_STORE_FILE: '/tmp/x.json' } as NodeJS.ProcessEnv)).toBeInstanceOf(
      EncryptedFileStore,
    );
  });
  it('returns an InMemoryStore otherwise', () => {
    expect(selectStore({} as NodeJS.ProcessEnv)).toBeInstanceOf(InMemoryStore);
  });
});
