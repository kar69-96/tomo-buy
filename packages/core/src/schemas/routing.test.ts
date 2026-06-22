import { describe, it, expect } from 'vitest';
import { PathSchema, RoutingDecisionSchema, ExplainReasonSchema } from './routing.js';
import type { Path, RoutingDecision } from './routing.js';

/**
 * Exhaustiveness guard: this switch must handle every Path member. If a new
 * member is added to the enum and not handled here, the `never` assignment in
 * `default` fails to compile — freezing the contract against silent drift.
 */
function describePath(p: Path): string {
  switch (p) {
    case 'P0':
      return 'machine rail';
    case 'P1':
      return 'sso token';
    case 'P2':
      return 'guest checkout';
    case 'P3':
      return 'autonomous signup';
    case 'P3_ASSISTED':
      return 'human-relayed';
    case 'AGENTCARD_BUY':
      return 'lane a buy';
    case 'EXPLAIN_CANT':
      return 'explain cant';
    default: {
      const _exhaustive: never = p;
      return _exhaustive;
    }
  }
}

describe('PathSchema', () => {
  it('contains exactly the frozen members', () => {
    expect([...PathSchema.options].sort()).toEqual(
      ['AGENTCARD_BUY', 'EXPLAIN_CANT', 'P0', 'P1', 'P2', 'P3', 'P3_ASSISTED'].sort(),
    );
  });

  it('maps every member via the exhaustive switch', () => {
    for (const p of PathSchema.options) {
      expect(describePath(p)).toBeTypeOf('string');
    }
  });

  it('rejects an unknown path', () => {
    expect(() => PathSchema.parse('P9')).toThrow();
  });
});

describe('RoutingDecisionSchema', () => {
  it('round-trips a plain decision', () => {
    const d: RoutingDecision = { path: 'P2', merchant_id: 'm_1', reasons: ['guest checkout ok'] };
    expect(RoutingDecisionSchema.parse(d)).toEqual(d);
  });

  it('round-trips an EXPLAIN_CANT decision with detail', () => {
    const d: RoutingDecision = {
      path: 'EXPLAIN_CANT',
      merchant_id: 'm_1',
      reasons: ['forces 3ds', 'no guest checkout'],
      explain_cant: { reason: 'step-up required', offer: 'try again with SSO', disclose_whats_lost: true },
    };
    expect(RoutingDecisionSchema.parse(d)).toEqual(d);
  });

  it('rejects a missing reasons array', () => {
    expect(() => RoutingDecisionSchema.parse({ path: 'P2', merchant_id: 'm_1' })).toThrow();
  });
});

describe('ExplainReasonSchema', () => {
  it('requires a reason', () => {
    expect(() => ExplainReasonSchema.parse({ offer: 'x' })).toThrow();
  });
});
