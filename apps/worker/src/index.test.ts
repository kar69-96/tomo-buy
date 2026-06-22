import { describe, it, expect } from 'vitest';
import { NotImplementedError } from '@tomo/core';
import { startWorker } from './index.js';

describe('startWorker', () => {
  it('throws NotImplementedError', () => {
    expect(() => startWorker()).toThrow(NotImplementedError);
  });
});
