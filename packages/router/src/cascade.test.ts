import { describe, it, expect } from 'vitest';
import { RoutingDecisionSchema } from '@tomo/core';
import type { MerchantProfile, TaskIntent } from '@tomo/core';
import { route } from './cascade.js';

/** A Lane-B, no-frills profile. Override per-case to exercise a single branch. */
function profile(overrides: Partial<MerchantProfile> = {}): MerchantProfile {
  return {
    merchant_id: 'merchant_test',
    lane: 'B',
    terminal_rail: false,
    sso_grant: false,
    guest_checkout: false,
    account_required: false,
    automation_hostility: 'low',
    forces_3ds: false,
    phone_required: false,
    profile_version: 1,
    last_verified_at: '2026-06-22T00:00:00Z',
    ...overrides,
  };
}

function intent(overrides: Partial<TaskIntent> = {}): TaskIntent {
  return {
    merchant_id: 'merchant_test',
    cart_spec: { natural: 'one large pepperoni pizza' },
    price_ceiling_cents: 5000,
    account_bound: false,
    ship_to_ref: 'vaultB:user_1:home',
    ...overrides,
  };
}

describe('route — §6 deterministic cascade', () => {
  it('returns a schema-valid RoutingDecision', () => {
    const d = route(profile({ guest_checkout: true }), intent());
    expect(() => RoutingDecisionSchema.parse(d)).not.toThrow();
    expect(d.merchant_id).toBe('merchant_test');
    expect(d.reasons.length).toBeGreaterThan(0);
  });

  // ---- STEP 0: Lane A short-circuit ----
  describe('STEP 0 — Lane A', () => {
    it('Lane A → EXPLAIN_CANT(lane_a_unavailable)', () => {
      const d = route(profile({ lane: 'A' }), intent());
      expect(d.path).toBe('EXPLAIN_CANT');
      expect(d.explain_cant?.reason).toBe('lane_a_unavailable');
    });

    it('Lane A wins even when other flags would route elsewhere', () => {
      const d = route(
        profile({ lane: 'A', guest_checkout: true, terminal_rail: true }),
        intent({ account_bound: true }),
      );
      expect(d.path).toBe('EXPLAIN_CANT');
      expect(d.explain_cant?.reason).toBe('lane_a_unavailable');
    });
  });

  // ---- STEP 1: account_bound BEFORE terminal_rail (the ordering fix) ----
  describe('STEP 1 — account_bound ordering fix', () => {
    it('HEADLINE: account_bound + terminal_rail + sso_grant → P1 (never P0)', () => {
      const d = route(
        profile({ terminal_rail: true, sso_grant: true }),
        intent({ account_bound: true }),
      );
      expect(d.path).toBe('P1');
      expect(d.path).not.toBe('P0');
    });

    it('HEADLINE: account_bound + terminal_rail + no SSO → EXPLAIN_CANT (never P0)', () => {
      const d = route(
        profile({ terminal_rail: true, sso_grant: false }),
        intent({ account_bound: true }),
      );
      expect(d.path).toBe('EXPLAIN_CANT');
      expect(d.explain_cant?.reason).toBe('cant_reach_existing_account');
      expect(d.path).not.toBe('P0');
    });

    it('account_bound + sso_grant → P1', () => {
      const d = route(profile({ sso_grant: true }), intent({ account_bound: true }));
      expect(d.path).toBe('P1');
    });

    it('account_bound + no SSO → EXPLAIN_CANT(cant_reach_existing_account) with honest disclosure', () => {
      const d = route(profile({ sso_grant: false }), intent({ account_bound: true }));
      expect(d.path).toBe('EXPLAIN_CANT');
      expect(d.explain_cant?.reason).toBe('cant_reach_existing_account');
      expect(d.explain_cant?.offer).toBe('fresh_order');
      expect(d.explain_cant?.disclose_whats_lost).toBe(true);
    });
  });

  // ---- STEP 2: terminal rail (fresh, not account-bound) ----
  describe('STEP 2 — terminal rail', () => {
    it('terminal_rail + not account_bound → P0', () => {
      const d = route(profile({ terminal_rail: true }), intent({ account_bound: false }));
      expect(d.path).toBe('P0');
    });

    it('terminal_rail wins over guest_checkout when not account-bound', () => {
      const d = route(
        profile({ terminal_rail: true, guest_checkout: true }),
        intent({ account_bound: false }),
      );
      expect(d.path).toBe('P0');
    });
  });

  // ---- STEP 3: no account relationship required ----
  describe('STEP 3 — guest / account_required tree', () => {
    it('guest_checkout → P2', () => {
      const d = route(profile({ guest_checkout: true }), intent());
      expect(d.path).toBe('P2');
    });

    it('account_required + forces_3ds → EXPLAIN_CANT(3ds_wall) [dead-corner]', () => {
      const d = route(
        profile({ account_required: true, forces_3ds: true }),
        intent(),
      );
      expect(d.path).toBe('EXPLAIN_CANT');
      expect(d.explain_cant?.reason).toBe('3ds_wall');
    });

    it('account_required + high hostility + sso_grant → P1', () => {
      const d = route(
        profile({ account_required: true, automation_hostility: 'high', sso_grant: true }),
        intent(),
      );
      expect(d.path).toBe('P1');
    });

    it('account_required + high hostility + no SSO → P3_ASSISTED', () => {
      const d = route(
        profile({ account_required: true, automation_hostility: 'high', sso_grant: false }),
        intent(),
      );
      expect(d.path).toBe('P3_ASSISTED');
    });

    it('account_required + med hostility → P3', () => {
      const d = route(
        profile({ account_required: true, automation_hostility: 'med' }),
        intent(),
      );
      expect(d.path).toBe('P3');
    });

    it('account_required + low hostility → P3', () => {
      const d = route(
        profile({ account_required: true, automation_hostility: 'low' }),
        intent(),
      );
      expect(d.path).toBe('P3');
    });

    it('not guest, not account_required → EXPLAIN_CANT(no_viable_path) [dead-corner]', () => {
      const d = route(
        profile({ guest_checkout: false, account_required: false }),
        intent(),
      );
      expect(d.path).toBe('EXPLAIN_CANT');
      expect(d.explain_cant?.reason).toBe('no_viable_path');
    });
  });

  // ---- purity / determinism ----
  describe('purity', () => {
    it('same inputs always yield the same output', () => {
      const p = profile({ guest_checkout: true });
      const i = intent();
      expect(route(p, i)).toEqual(route(p, i));
    });

    it('does not mutate its inputs', () => {
      const p = profile({ guest_checkout: true });
      const i = intent();
      const pCopy = structuredClone(p);
      const iCopy = structuredClone(i);
      route(p, i);
      expect(p).toEqual(pCopy);
      expect(i).toEqual(iCopy);
    });
  });
});
