import { describe, it, expect } from 'vitest';
import {
  TomoError,
  FundingError,
  RoutingError,
  ExecutorError,
  VaultError,
  ApprovalError,
  ReconciliationError,
  NotImplementedError,
} from './errors.js';

const subclasses = [
  ['FundingError', FundingError, 'FUNDING_ERROR'],
  ['RoutingError', RoutingError, 'ROUTING_ERROR'],
  ['ExecutorError', ExecutorError, 'EXECUTOR_ERROR'],
  ['VaultError', VaultError, 'VAULT_ERROR'],
  ['ApprovalError', ApprovalError, 'APPROVAL_ERROR'],
  ['ReconciliationError', ReconciliationError, 'RECONCILIATION_ERROR'],
] as const;

describe('TomoError hierarchy', () => {
  it.each(subclasses)('%s is a TomoError and an Error with the right code/name', (name, Ctor, code) => {
    const err = new Ctor('boom');
    expect(err).toBeInstanceOf(TomoError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe(name);
    expect(err.code).toBe(code);
    expect(err.message).toBe('boom');
  });

  it('preserves a thrown subclass through instanceof checks', () => {
    try {
      throw new FundingError('hold failed');
    } catch (e) {
      expect(e).toBeInstanceOf(FundingError);
      expect(e).toBeInstanceOf(TomoError);
    }
  });

  it('attaches a cause when provided', () => {
    const root = new Error('root');
    const err = new RoutingError('wrapped', { cause: root });
    expect(err.cause).toBe(root);
  });

  it('leaves cause undefined when not provided', () => {
    const err = new VaultError('no cause');
    expect(err.cause).toBeUndefined();
  });
});

describe('NotImplementedError', () => {
  it('has a default message and the NOT_IMPLEMENTED code', () => {
    const err = new NotImplementedError();
    expect(err).toBeInstanceOf(TomoError);
    expect(err.code).toBe('NOT_IMPLEMENTED');
    expect(err.name).toBe('NotImplementedError');
    expect(err.message).toContain('not implemented');
  });

  it('accepts a custom message and cause', () => {
    const root = new Error('root');
    const err = new NotImplementedError('issueCard not wired', { cause: root });
    expect(err.message).toBe('issueCard not wired');
    expect(err.cause).toBe(root);
  });
});
