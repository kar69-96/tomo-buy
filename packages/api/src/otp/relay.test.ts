import { describe, it, expect } from 'vitest';
import { OtpRelay } from './relay.js';

describe('OtpRelay', () => {
  it('relays and consumes codes FIFO', () => {
    const relay = new OtpRelay();
    relay.relay('wf-1', '123456');
    relay.relay('wf-1', '654321');
    expect(relay.pending('wf-1')).toEqual(['123456', '654321']);
    expect(relay.consume('wf-1')).toBe('123456');
    expect(relay.consume('wf-1')).toBe('654321');
    expect(relay.consume('wf-1')).toBeUndefined();
  });

  it('trims codes and isolates by workflow', () => {
    const relay = new OtpRelay();
    relay.relay('wf-1', '  111  ');
    expect(relay.pending('wf-1')).toEqual(['111']);
    expect(relay.pending('wf-2')).toEqual([]);
  });

  it('rejects empty workflowId or code', () => {
    const relay = new OtpRelay();
    expect(() => relay.relay('', '123')).toThrow();
    expect(() => relay.relay('wf-1', '')).toThrow();
    expect(() => relay.relay('wf-1', '   ')).toThrow();
  });

  it('pending is an immutable copy', () => {
    const relay = new OtpRelay();
    relay.relay('wf-1', '123');
    const view = relay.pending('wf-1') as string[];
    view.push('999');
    expect(relay.pending('wf-1')).toEqual(['123']);
  });
});
