import { describe, it, expect, beforeEach } from 'vitest';
import { VaultError } from '@tomo/core';
import { VaultA } from './vault-a.js';
import { InMemoryStore } from './store.js';

const KEY = 'master-key-server-side';

describe('VaultA', () => {
  let vault: VaultA;
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
    vault = new VaultA(store, KEY);
  });

  it('writes once and reads back the agent credential', async () => {
    await vault.write('u1', 'acme', { username: 'agent_u1', password: 'p@ss-w0rd' });
    expect(await vault.read('u1', 'acme')).toEqual({ username: 'agent_u1', password: 'p@ss-w0rd' });
  });

  it('rejects overwrite (write-once)', async () => {
    await vault.write('u1', 'acme', { username: 'a', password: 'b' });
    await expect(vault.write('u1', 'acme', { username: 'c', password: 'd' })).rejects.toBeInstanceOf(
      VaultError,
    );
  });

  it('throws VaultError reading a missing credential', async () => {
    await expect(vault.read('nobody', 'acme')).rejects.toBeInstanceOf(VaultError);
  });

  it('stores only ciphertext at rest (no password in the store)', async () => {
    await vault.write('u1', 'acme', { username: 'agent_u1', password: 'p@ss-w0rd' });
    const raw = JSON.stringify([...(await store.keys())].map(() => store));
    const blob = await store.get('a:u1:acme');
    expect(JSON.stringify(blob)).not.toContain('p@ss-w0rd');
    expect(raw).not.toContain('p@ss-w0rd');
  });

  it('has() reports existence without returning a secret', async () => {
    expect(await vault.has('u1', 'acme')).toBe(false);
    await vault.write('u1', 'acme', { username: 'a', password: 'b' });
    expect(await vault.has('u1', 'acme')).toBe(true);
  });

  it('rejects an invalid credential shape at write', async () => {
    // @ts-expect-error testing runtime validation
    await expect(vault.write('u1', 'acme', { username: '' })).rejects.toBeTruthy();
  });
});
