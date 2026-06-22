import { describe, it, expect } from 'vitest';
import { NotImplementedError } from '@tomo/core';
import { ExecutorStub } from './index.js';

describe('ExecutorStub', () => {
  it('rejects fillAndSubmit with NotImplementedError', async () => {
    const cardRef = { cardId: 'c', cardholderId: 'ch', merchantId: 'm', amountCents: 100, status: 'active' as const };
    await expect(new ExecutorStub().fillAndSubmit(cardRef, ['email'])).rejects.toBeInstanceOf(NotImplementedError);
  });
});
