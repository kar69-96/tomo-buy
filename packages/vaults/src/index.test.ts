import { describe, it, expect } from 'vitest';
import { NotImplementedError } from '@tomo/core';
import { VaultAStub, VaultBStub } from './index.js';

describe('vault stubs', () => {
  it('VaultA.read rejects with NotImplementedError', async () => {
    await expect(new VaultAStub().read('u', 'm')).rejects.toBeInstanceOf(NotImplementedError);
  });
  it('VaultB.releaseField rejects with NotImplementedError', async () => {
    await expect(new VaultBStub().releaseField('u', 'email')).rejects.toBeInstanceOf(NotImplementedError);
  });
});
