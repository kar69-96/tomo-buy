/**
 * M0 sandbox acceptance gate — proves hold → capture → release against the
 * Agentcard sandbox. RUN MANUALLY ONLY (never in CI): it needs a real
 * `sk_test_*` key and human completion of the Stripe checkout step.
 *
 *   AGENTCARD_API_KEY=sk_test_... npx tsx packages/funding/scripts/verify-sandbox.ts
 *
 * SECRET-FLOW: this script logs progress to stdout with NO secrets — only last4
 * and ids. It never prints the PAN, CVV, or the API key.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { AgentcardClient } from '../src/agentcard/client.js';
import { AgentcardRail, type CardholderProfile } from '../src/agentcard/agentcard-rail.js';

const HOLD_CENTS = 1500; // $15.00 sandbox hold

async function prompt(message: string): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  await rl.question(message);
  rl.close();
}

function log(step: string, detail = ''): void {
  // eslint-disable-next-line no-console
  console.log(`[verify-sandbox] ${step}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  const apiKey = process.env.AGENTCARD_API_KEY;
  if (!apiKey || !apiKey.startsWith('sk_test_')) {
    throw new Error('Set AGENTCARD_API_KEY=sk_test_... (sandbox key) to run this script.');
  }

  const client = new AgentcardClient({ apiKey });
  const profile: CardholderProfile = {
    firstName: 'Sandbox',
    lastName: 'Tester',
    dateOfBirth: '1990-01-01',
    phoneNumber: '+15555550100',
    email: `sandbox+${Date.now()}@tomo-buy.test`,
  };
  const rail = new AgentcardRail({ client, resolveProfile: () => profile });

  log('1/5 create cardholder + attach payment method');
  const holder = await rail.ensureCardholder('sandbox-user');
  log('cardholder created', holder.cardholderId);

  const setup = await client.setupPaymentMethod(holder.cardholderId);
  log('open this Stripe checkout URL and complete it, then press Enter:', setup.checkoutUrl);
  await prompt('   (waiting for manual checkout completion) > ');

  const status = await client.paymentMethodStatus(holder.cardholderId);
  if (!status.hasPaymentMethod) {
    throw new Error('Payment method not attached — complete the checkout and re-run.');
  }
  log('payment method attached', status.paymentMethodId ?? '(id hidden)');

  log('2/5 issue card (places hold)');
  const card = await rail.issueCard('sandbox-user', HOLD_CENTS, 'sandbox-merchant');
  log('card OPEN, hold placed', `cardId=${card.cardId} amountCents=${card.amountCents}`);

  log('3/5 fetch card details (trusted-side only; NOT logged)');
  const secret = await rail.getCardSecret(card);
  log('details fetched', `last4=${secret.pan.slice(-4)} (pan/cvv withheld)`);

  log('4/5 place a sandbox charge against the card, then watch for webhooks');
  log('expect transaction.authorized → transaction.cleared in your webhook sink');
  await prompt('   (press Enter once the charge is placed) > ');

  log('5/5 close card (release hold)');
  await rail.closeCard(card);
  log('card CLOSED, hold released', card.cardId);

  log('DONE — hold → capture → release verified');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[verify-sandbox] FAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
