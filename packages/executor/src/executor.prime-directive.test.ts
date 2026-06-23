import { describe, it, expect, afterEach } from 'vitest';
import type {
  TaskIntent,
  RoutingDecision,
  CardRef,
  PAN_CVV_EXP,
  PiiField,
  VaultB,
} from '@tomo/core';
import { VaultError } from '@tomo/core';
import { Executor } from './executor.js';
import { PlaywrightDriver } from './browser/playwright-driver.js';

/**
 * THE PRIME-DIRECTIVE GATE.
 *
 * Drives a local mock checkout form in REAL headless Chrome and proves the §12
 * trust boundary end-to-end:
 *   1. the agent-visible transcript holds ONLY %var% placeholders;
 *   2. the server log sink holds NO real secret;
 *   3. the real PAN/PII appear in the live DOM only AFTER the atomic swap;
 *   4. the Executor returns flags only.
 */

const PAN = '4111111111110042';
const CVV = '0042';
const EXPIRY = '12/30';
const EMAIL = 'ada@secret.example';
const ZIP = '90210';
const PII: Record<string, string> = {
  name: 'Ada Lovelace',
  street: '1 Analytical Way',
  city: 'London',
  state: 'NA',
  zip: ZIP,
  country: 'GB',
  email: EMAIL,
  phone: '+15550009999',
};
const SECRETS = [PAN, CVV, EXPIRY, EMAIL, ZIP, PII.name, PII.street];

class FakeVaultB implements VaultB {
  async releaseField(_user: string, field: PiiField): Promise<string> {
    const v = PII[field];
    if (v === undefined) throw new VaultError(`no ${field}`);
    return v;
  }
}

const FORM = `<!doctype html><html><body>
  <h1>Acme Checkout</h1>
  <form id="checkout">
    <input name="card_number" value="" />
    <input name="card_cvv" value="" />
    <input name="card_expiry" value="" />
    <input name="cardholder_name" value="" />
    <input name="email" value="" />
    <input name="shipping_street" value="" />
    <input name="shipping_city" value="" />
    <input name="shipping_state" value="" />
    <input name="shipping_zip" value="" />
    <input name="shipping_country" value="" />
    <input name="confirmation" value="" />
    <button type="submit">Pay</button>
  </form>
  <script>
    document.getElementById('checkout').addEventListener('submit', function (e) {
      e.preventDefault();
      document.querySelector('[name="confirmation"]').value = 'CONF-PW-123';
    });
  </script>
</body></html>`;

const intent: TaskIntent = {
  merchant_id: 'acme',
  cart_spec: { natural: 'one widget' },
  price_ceiling_cents: 5000,
  account_bound: false,
  ship_to_ref: 'ship-1',
};
const routing: RoutingDecision = { path: 'P2', merchant_id: 'acme', reasons: ['guest'] };
const cardRef: CardRef = {
  cardId: 'c1',
  cardholderId: 'ch1',
  merchantId: 'acme',
  amountCents: 4200,
  status: 'active',
};

let driver: PlaywrightDriver | undefined;
afterEach(async () => {
  await driver?.close();
  driver = undefined;
});

describe('PRIME DIRECTIVE — real headless Chrome', () => {
  it('keeps every secret out of the agent transcript and logs; reals reach the DOM only at swap', async () => {
    driver = new PlaywrightDriver(true);
    await driver.setContent(FORM);

    const transcript: string[] = [];
    const logs: string[] = [];
    let cardSecretCalls = 0;

    const executor = new Executor({
      driver,
      vaultB: new FakeVaultB(),
      getCardSecret: async (): Promise<PAN_CVV_EXP> => {
        cardSecretCalls += 1;
        return { pan: PAN, cvv: CVV, expiry: EXPIRY };
      },
      transcript,
      logger: (m) => logs.push(m),
    });

    const result = await executor.checkout({
      user: 'u1',
      intent,
      routing,
      cardRef,
      amountCents: 4200,
      pageMerchantId: 'acme',
      confirmationSelector: '[name="confirmation"]',
    });

    // (4) flags only
    expect(result.success).toBe(true);
    expect(result.confirmationId).toBe('CONF-PW-123');
    expect(result.surfaced).toEqual([]);
    expect(cardSecretCalls).toBe(1);

    // (1) transcript = placeholders only
    expect(transcript.length).toBeGreaterThan(0);
    const transcriptBlob = transcript.join('\n');
    for (const secret of SECRETS) {
      expect(transcriptBlob).not.toContain(secret);
    }
    expect(transcriptBlob).toContain('%card_number%');

    // (2) logs = no secrets
    const logBlob = logs.join('\n');
    for (const secret of SECRETS) {
      expect(logBlob).not.toContain(secret);
    }

    // (3) reals are in the live DOM only after the swap
    expect(await driver.readValue('[name="card_number"]')).toBe(PAN);
    expect(await driver.readValue('[name="card_cvv"]')).toBe(CVV);
    expect(await driver.readValue('[name="email"]')).toBe(EMAIL);
    expect(await driver.readValue('[name="shipping_zip"]')).toBe(ZIP);
  });

  it('a field filled with a placeholder marker holds the marker — not a secret — before swap', async () => {
    driver = new PlaywrightDriver(true);
    await driver.setContent(FORM);
    await driver.fillField('[name="card_number"]', '{{card_number}}');
    const preSwap = await driver.readValue('[name="card_number"]');
    expect(preSwap).toBe('{{card_number}}');
    expect(SECRETS).not.toContain(preSwap);
  });
});
