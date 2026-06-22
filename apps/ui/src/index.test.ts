import { describe, it, expect } from 'vitest';
import { NotImplementedError } from '@tomo/core';
import { startUi } from './index.js';

describe('startUi', () => {
  it('throws NotImplementedError', () => {
    expect(() => startUi()).toThrow(NotImplementedError);
  });
});
