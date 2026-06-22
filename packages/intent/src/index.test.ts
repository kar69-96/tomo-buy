import { describe, it, expect } from 'vitest';
import { NotImplementedError } from '@tomo/core';
import { IntentParserStub } from './index.js';

describe('IntentParserStub', () => {
  it('rejects parse with NotImplementedError', async () => {
    await expect(new IntentParserStub().parse('buy sushi')).rejects.toBeInstanceOf(NotImplementedError);
  });
});
