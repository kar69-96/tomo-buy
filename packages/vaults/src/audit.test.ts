import { describe, it, expect } from 'vitest';
import { AuditLog } from './audit.js';

describe('AuditLog', () => {
  it('records one entry per release and never stores a value', () => {
    const log = new AuditLog();
    const entry = log.record('u1', 'email', 'executor:checkout', '2026-06-22T00:00:00.000Z');
    expect(entry).toEqual({
      user: 'u1',
      field: 'email',
      requester: 'executor:checkout',
      at: '2026-06-22T00:00:00.000Z',
    });
    expect(Object.keys(entry)).not.toContain('value');
    expect(log.count('u1')).toBe(1);
  });

  it('entries are frozen and all() returns an immutable copy', () => {
    const log = new AuditLog();
    log.record('u1', 'zip', 'r', '2026-06-22T00:00:00.000Z');
    const all = log.all();
    expect(Object.isFrozen(all[0])).toBe(true);
    // Mutating the returned array must not affect the log.
    (all as unknown as unknown[]).push({});
    expect(log.all()).toHaveLength(1);
  });

  it('filters by user and counts by field', () => {
    const log = new AuditLog();
    log.record('u1', 'email', 'r', 't');
    log.record('u1', 'zip', 'r', 't');
    log.record('u2', 'email', 'r', 't');
    expect(log.forUser('u1')).toHaveLength(2);
    expect(log.count('u1', 'email')).toBe(1);
    expect(log.count('u1')).toBe(2);
    expect(log.count('u2', 'zip')).toBe(0);
  });
});
