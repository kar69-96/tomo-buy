import { describe, it, expect } from 'vitest';
import {
  CardholderRefSchema,
  CardRefSchema,
  PanCvvExpSchema,
  TxnSchema,
  ChargeEventSchema,
  OrderSpecSchema,
  SettlementSchema,
} from './funding.js';
import type { CardRef, Txn } from './funding.js';

const cardRef: CardRef = {
  cardId: 'card_1',
  cardholderId: 'ch_1',
  merchantId: 'm_1',
  amountCents: 4000,
  status: 'active',
};

describe('CardholderRefSchema', () => {
  it('parses a valid cardholder ref', () => {
    const v = { cardholderId: 'ch_1', userId: 'user_1' };
    expect(CardholderRefSchema.parse(v)).toEqual(v);
  });

  it('rejects a missing field', () => {
    expect(() => CardholderRefSchema.parse({ cardholderId: 'ch_1' })).toThrow();
  });
});

describe('CardRefSchema', () => {
  it('round-trips a valid card ref', () => {
    expect(CardRefSchema.parse(cardRef)).toEqual(cardRef);
  });

  it('rejects a float amountCents (cents rule)', () => {
    expect(() => CardRefSchema.parse({ ...cardRef, amountCents: 40.0 + 0.5 })).toThrow();
  });

  it('rejects an unknown status', () => {
    expect(() => CardRefSchema.parse({ ...cardRef, status: 'frozen' })).toThrow();
  });
});

describe('PanCvvExpSchema', () => {
  it('parses a secret triple shape', () => {
    const secret = { pan: '4111111111111111', cvv: '123', expiry: '12/29' };
    expect(PanCvvExpSchema.parse(secret)).toEqual(secret);
  });

  it('rejects an empty pan', () => {
    expect(() => PanCvvExpSchema.parse({ pan: '', cvv: '123', expiry: '12/29' })).toThrow();
  });
});

describe('TxnSchema', () => {
  it('round-trips a transaction with optional merchant', () => {
    const txn: Txn = {
      txId: 'tx_1',
      cardId: 'card_1',
      amountCents: 4000,
      status: 'cleared',
      merchant: 'sushiplace.com',
      occurredAt: '2026-06-22T17:00:00.000Z',
    };
    expect(TxnSchema.parse(txn)).toEqual(txn);
  });

  it('rejects an invalid status', () => {
    expect(() =>
      TxnSchema.parse({
        txId: 'tx_1',
        cardId: 'card_1',
        amountCents: 4000,
        status: 'pending',
        occurredAt: '2026-06-22T17:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('ChargeEventSchema', () => {
  it('parses a known webhook event type', () => {
    const ev = {
      type: 'transaction.authorized',
      cardId: 'card_1',
      txId: 'tx_1',
      amountCents: 4000,
      occurredAt: '2026-06-22T17:00:00.000Z',
    };
    expect(ChargeEventSchema.parse(ev)).toEqual(ev);
  });

  it('rejects an unknown event type', () => {
    expect(() =>
      ChargeEventSchema.parse({
        type: 'transaction.refunded',
        cardId: 'card_1',
        occurredAt: '2026-06-22T17:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('OrderSpecSchema', () => {
  it('round-trips an order with one item', () => {
    const order = {
      vendorId: 'v_1',
      items: [{ name: 'API call', qty: 1, unitCents: 100 }],
      totalCents: 100,
    };
    expect(OrderSpecSchema.parse(order)).toEqual(order);
  });

  it('rejects an empty item list', () => {
    expect(() => OrderSpecSchema.parse({ vendorId: 'v_1', items: [], totalCents: 0 })).toThrow();
  });
});

describe('SettlementSchema', () => {
  it('parses a settled result', () => {
    const s = {
      settlementId: 's_1',
      vendorId: 'v_1',
      amountCents: 100,
      status: 'settled',
      chain: 'base',
      asset: 'USDC',
      txHash: '0xabc',
      occurredAt: '2026-06-22T17:00:00.000Z',
    };
    expect(SettlementSchema.parse(s)).toEqual(s);
  });
});
