import { describe, it, expect } from 'vitest';
import { NotImplementedError } from '@tomo/core';
import { ProfileStoreStub } from './index.js';

describe('ProfileStoreStub', () => {
  it('rejects load with NotImplementedError', async () => {
    await expect(new ProfileStoreStub().load('m')).rejects.toBeInstanceOf(NotImplementedError);
  });
});
