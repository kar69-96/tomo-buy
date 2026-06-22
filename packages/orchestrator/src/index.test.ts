import { describe, it, expect } from 'vitest';
import { NotImplementedError } from '@tomo/core';
import { OrchestratorStub } from './index.js';

describe('OrchestratorStub', () => {
  it('rejects run with NotImplementedError', async () => {
    await expect(new OrchestratorStub().run({ path: 'P2', merchant_id: 'm', reasons: [] })).rejects.toBeInstanceOf(NotImplementedError);
  });
});
