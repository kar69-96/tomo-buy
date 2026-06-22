import { describe, it, expect } from 'vitest';
import { PiiFieldSchema, AgentCredentialSchema } from './vault.js';
import type { PiiField } from './vault.js';

describe('PiiFieldSchema', () => {
  it('contains exactly the frozen PII fields', () => {
    expect([...PiiFieldSchema.options].sort()).toEqual(
      ['city', 'country', 'email', 'name', 'phone', 'state', 'street', 'zip'].sort(),
    );
  });

  it('accepts each known field', () => {
    for (const f of PiiFieldSchema.options) {
      const parsed: PiiField = PiiFieldSchema.parse(f);
      expect(parsed).toBe(f);
    }
  });

  it('rejects an unknown field', () => {
    expect(() => PiiFieldSchema.parse('ssn')).toThrow();
  });
});

describe('AgentCredentialSchema', () => {
  it('round-trips a credential', () => {
    const c = { username: 'agent_user_1', password: 'high-entropy' };
    expect(AgentCredentialSchema.parse(c)).toEqual(c);
  });

  it('rejects a missing password', () => {
    expect(() => AgentCredentialSchema.parse({ username: 'agent_user_1' })).toThrow();
  });
});
