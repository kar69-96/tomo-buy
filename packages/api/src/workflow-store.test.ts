import { describe, it, expect } from 'vitest';
import type { TaskIntent } from '@tomo/core';
import { WorkflowStore } from './workflow-store.js';

const intent: TaskIntent = {
  merchant_id: 'merchant_test',
  cart_spec: { natural: 'one widget' },
  price_ceiling_cents: 5000,
  account_bound: false,
  ship_to_ref: 'vaultB:user1:default',
};

const rec = {
  workflowId: 'wf-1',
  userId: 'user1',
  intent,
  routedMerchant: 'merchant_test',
  estimateCents: 1800,
};

describe('WorkflowStore', () => {
  it('puts and gets a record', () => {
    const store = new WorkflowStore();
    store.put(rec);
    expect(store.get('wf-1')).toEqual(rec);
    expect(store.has('wf-1')).toBe(true);
  });

  it('returns undefined for an unknown id', () => {
    const store = new WorkflowStore();
    expect(store.get('nope')).toBeUndefined();
    expect(store.has('nope')).toBe(false);
  });

  it('returns fresh copies — mutating a result never aliases internal state', () => {
    const store = new WorkflowStore();
    store.put(rec);
    const got = store.get('wf-1')!;
    (got as { estimateCents: number }).estimateCents = 9999;
    expect(store.get('wf-1')!.estimateCents).toBe(1800);
  });

  it('does not alias the input record after put', () => {
    const store = new WorkflowStore();
    const input = { ...rec };
    store.put(input);
    (input as { estimateCents: number }).estimateCents = 1;
    expect(store.get('wf-1')!.estimateCents).toBe(1800);
  });

  it('lists all records as copies', () => {
    const store = new WorkflowStore();
    store.put(rec);
    store.put({ ...rec, workflowId: 'wf-2' });
    const all = store.all();
    expect(all.map((r) => r.workflowId).sort()).toEqual(['wf-1', 'wf-2']);
  });
});
