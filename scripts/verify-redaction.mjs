/**
 * verify-redaction.mjs — prove the vision trust boundary holds.
 *
 * Vision sends a screenshot of the page to the LLM on every browser-agent
 * decision. `captureRedactedScreenshot` (packages/checkout/src/redact.ts) paints
 * opaque boxes over card fields, PII-valued inputs, and payment iframes first, so
 * no secret pixel reaches the model. This script lets you SEE that working.
 *
 * Both modes set CHECKOUT_REDACT_DIR, so every redacted frame the model receives
 * is written to disk for you to eyeball. Open the output dir when it finishes.
 *
 * Usage (run from repo root; build first with `pnpm build`):
 *
 *   # Deterministic, money-free, offline. Fake PAN + PII on a local fixture →
 *   # proves the card number and PII are blacked out. THE definitive PAN check.
 *   node --env-file=.env scripts/verify-redaction.mjs fixture
 *
 *   # Real no-spend dry-run: drives a live checkout to the payment page and
 *   # parks (no Agentcard issued, no card typed). Verifies PII redaction + the
 *   # aggressive payment-page cover end-to-end. Needs OPENROUTER_API_KEY.
 *   node --env-file=.env scripts/verify-redaction.mjs dry-run <productUrl> [price]
 *
 * Env knobs (auto-defaulted here): HEADLESS=false (watch it), CHECKOUT_REDACT_DIR,
 * CHECKOUT_TRACE_DIR.
 */

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  runCheckout,
  createSession,
  destroySession,
  captureRedactedScreenshot,
} from "../packages/checkout/dist/index.js";

// --- Output dir + env wiring (must be set before the checkout loop reads them) ---
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = resolve(
  process.env.CHECKOUT_REDACT_DIR ?? join(".redaction-check", stamp),
);
mkdirSync(outDir, { recursive: true });
process.env.CHECKOUT_REDACT_DIR = outDir;
process.env.CHECKOUT_TRACE_DIR ??= outDir;
if (process.env.HEADLESS === undefined) process.env.HEADLESS = "false";

// Clearly-fake PII used as the redaction target (matches the fixture inputs).
const TEST_PII = {
  name: "Jane Shopper",
  street: "1600 Amphitheatre Pkwy",
  city: "Mountain View",
  state: "CA",
  zip: "94043",
  country: "US",
  email: "jane.shopper@example.com",
  phone: "4155551234",
};

const FIXTURE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
  body{font:16px system-ui;margin:24px;max-width:560px}
  label{display:block;margin:10px 0 4px;color:#333}
  input{width:100%;padding:8px;font-size:15px;box-sizing:border-box}
  h2{margin-top:24px}
  .row{display:flex;gap:12px}.row>div{flex:1}
  iframe{border:1px solid #ccc;display:block;margin-top:6px}
  button{margin-top:18px;padding:10px 18px;font-size:15px}
</style></head><body>
  <h1>Checkout (redaction fixture)</h1>

  <h2>Contact &amp; shipping</h2>
  <label>Full name</label>
  <input name="name" autocomplete="name" value="${TEST_PII.name}">
  <label>Email</label>
  <input type="email" name="email" value="${TEST_PII.email}">
  <label>Address</label>
  <input name="address" autocomplete="street-address" value="${TEST_PII.street}">
  <div class="row">
    <div><label>City</label><input name="city" value="${TEST_PII.city}"></div>
    <div><label>State</label><input name="state" value="${TEST_PII.state}"></div>
    <div><label>ZIP</label><input name="zip" autocomplete="postal-code" value="${TEST_PII.zip}"></div>
  </div>

  <h2>Search (NOT sensitive — must stay visible in std mode)</h2>
  <input name="q" placeholder="search products" value="blue running shoes">

  <h2>Payment</h2>
  <label>Card number</label>
  <input name="cardnumber" autocomplete="cc-number" value="4242 4242 4242 4242">
  <div class="row">
    <div><label>Expiry</label><input name="cc-exp" autocomplete="cc-exp" value="12/29"></div>
    <div><label>CVC</label><input name="cc-csc" autocomplete="cc-csc" value="123"></div>
  </div>
  <label>Cardholder</label>
  <input id="cardholder" autocomplete="cc-name" value="JANE SHOPPER">

  <h2>Hosted card field (payment iframe — must be covered)</h2>
  <iframe src="https://js.stripe.com/v3/elements-inner-card.html" width="520" height="44"></iframe>

  <h2>Embedded video (non-payment iframe — only covered in aggressive mode)</h2>
  <iframe src="https://www.youtube.com/embed/dummy" width="520" height="120"></iframe>

  <button>Place order</button>
</body></html>`;

async function runFixture() {
  console.log("[fixture] launching local Chrome (HEADLESS=" + process.env.HEADLESS + ")");
  const session = await createSession({ domain: "redaction-fixture.local" });
  try {
    const page = session.page;
    // domcontentloaded so we don't block on the (intentionally fake) iframe srcs.
    await page.setContent(FIXTURE_HTML, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    // Raw, UN-redacted shot for side-by-side comparison.
    await page.screenshot({ path: join(outDir, "fixture-raw.png"), fullPage: true });

    const piiValues = Object.values(TEST_PII);

    // Standard mode: card fields + PII inputs + payment iframe covered; the search
    // box and the youtube iframe stay visible.
    await captureRedactedScreenshot(page, { piiValues, aggressive: false });
    // Aggressive mode (what payment pages use): every input + every iframe covered.
    await captureRedactedScreenshot(page, { piiValues, aggressive: true });

    console.log("\n[fixture] done. Compare in:", outDir);
    console.log("  fixture-raw.png        — original (PAN + PII visible)");
    console.log("  redact-000-std.jpg     — std mode (card/PII/payment-iframe blacked out)");
    console.log("  redact-001-aggressive.jpg — payment-page mode (every input + iframe blacked out)");
    console.log("\nCONFIRM: 4242 4242 4242 4242, the CVC, and the PII are NOT readable in the redact-*.jpg files.");
  } finally {
    await destroySession(session);
  }
}

async function runDryRun(url, price) {
  if (!url) {
    console.error("Usage: node --env-file=.env scripts/verify-redaction.mjs dry-run <productUrl> [price]");
    process.exit(2);
  }
  const p = price ?? "0";
  const order = {
    order_id: "dryrun-local",
    status: "awaiting_confirmation",
    product: { name: "dry-run target", url, price: p, source: hostOf(url) },
    payment: { total: p, price: p, fee: "0", fee_rate: "0" },
    shipping: TEST_PII,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  };

  console.log("[dry-run] no Agentcard is issued and no card is typed — cannot spend.");
  console.log("[dry-run] driving to the payment page and parking…\n");
  const result = await runCheckout({ order, shipping: order.shipping, dryRun: true });

  console.log("\n[dry-run] result:", {
    success: result.success,
    parkedAtPayment: result.parkedAtPayment,
    finalTotal: result.finalTotal,
    failedStep: result.failedStep,
    errorMessage: result.errorMessage,
  });
  console.log("\nRedacted frames the model saw are in:", outDir, "(redact-*.jpg)");
  console.log("CONFIRM: every redact-*-aggressive.jpg from the payment page shows the inputs blacked out.");
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

const [mode, ...rest] = process.argv.slice(2);
const run =
  mode === "fixture"
    ? runFixture()
    : mode === "dry-run"
      ? runDryRun(rest[0], rest[1])
      : Promise.reject(
          new Error(
            'Usage: node --env-file=.env scripts/verify-redaction.mjs <fixture|dry-run> [url] [price]',
          ),
        );

run.catch((err) => {
  console.error("verify-redaction failed:", err?.message ?? err);
  process.exit(1);
});
