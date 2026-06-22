import { describe, it, expect, beforeEach } from 'vitest';
import { VaultError } from '@tomo/core';
import { VaultB } from './vault-b.js';
import { InMemoryStore } from './store.js';

const KEY = 'master-key-server-side';

describe('VaultB', () => {
  let store: InMemoryStore;
  let vault: VaultB;

  beforeEach(async () => {
    store = new InMemoryStore();
    vault = new VaultB(store, KEY);
    await vault.setRecord('u1', {
      name: 'Ada Lovelace',
      street: '1 Analytical Way',
      city: 'London',
      zip: '90210',
      email: 'ada@example.com',
      phone: '+15551234567',
    });
  });

  it('releases one field and logs exactly one access', async () => {
    expect(await vault.releaseField('u1', 'email')).toBe('ada@example.com');
    expect(vault.auditLog().count('u1')).toBe(1);
    expect(vault.auditLog().count('u1', 'email')).toBe(1);
  });

  it('logs one entry per release (two releases → two entries)', async () => {
    await vault.releaseField('u1', 'email');
    await vault.releaseField('u1', 'zip');
    expect(vault.auditLog().count('u1')).toBe(2);
    const entries = vault.auditLog().forUser('u1');
    expect(entries.map((e) => e.field)).toEqual(['email', 'zip']);
    // Audit records carry no value.
    expect(JSON.stringify(entries)).not.toContain('ada@example.com');
  });

  it('records the requester context', async () => {
    await vault.releaseField('u1', 'name', 'executor:login');
    expect(vault.auditLog().forUser('u1')[0]?.requester).toBe('executor:login');
  });

  it('has no bulk-read method (structural data minimization)', () => {
    const v = vault as unknown as Record<string, unknown>;
    expect(v.releaseAll).toBeUndefined();
    expect(v.getRecord).toBeUndefined();
    expect(v.readAll).toBeUndefined();
  });

  it('throws VaultError releasing a field that is not set', async () => {
    await expect(vault.releaseField('u1', 'country')).rejects.toBeInstanceOf(VaultError);
    await expect(vault.releaseField('nobody', 'email')).rejects.toBeInstanceOf(VaultError);
  });

  it('stores only ciphertext at rest', async () => {
    const blob = await store.get('b:u1:email');
    expect(JSON.stringify(blob)).not.toContain('ada@example.com');
  });

  it('deleteUser removes all PII records (cryptographic erasure)', async () => {
    const removed = await vault.deleteUser('u1');
    expect(removed).toBe(6);
    expect(await store.keys()).toEqual([]);
    await expect(vault.releaseField('u1', 'email')).rejects.toBeInstanceOf(VaultError);
  });

  it('deleteUser only affects the named user', async () => {
    await vault.setField('u2', 'email', 'grace@example.com');
    await vault.deleteUser('u1');
    expect(await vault.releaseField('u2', 'email')).toBe('grace@example.com');
  });

  it('rejects an invalid field name at release', async () => {
    // @ts-expect-error testing runtime validation
    await expect(vault.releaseField('u1', 'ssn')).rejects.toBeTruthy();
  });
});
