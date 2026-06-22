import { describe, it, expect } from 'vitest';
import { NotImplementedError } from '@tomo/core';
import { FundingRailStub } from './index.js';

describe('FundingRailStub', () => {
  const stub = new FundingRailStub();
  it('rejects async methods with NotImplementedError', async () => {
    await expect(stub.ensureCardholder('u')).rejects.toBeInstanceOf(NotImplementedError);
  });
  it('throws synchronously from onWebhook', () => {
    expect(() => stub.onWebhook({ type: 'card.created', cardId: 'c', occurredAt: '2026-06-22T00:00:00Z' })).toThrow(
      NotImplementedError,
    );
  });
});
