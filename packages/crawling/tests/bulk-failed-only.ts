/**
 * Quick re-test of only the previously-failed URLs from the bulk test.
 * Baseline (Phase H, c=20): 10/61 passed + 15 detected 404, these 36 were null.
 *
 * Usage: set -a && source .env && set +a && BULK_TEST_CONCURRENCY=1 npx tsx packages/crawling/tests/bulk-failed-only.ts
 */

import { discoverViaFirecrawl } from "../src/discover.js";
import { isValidPrice } from "../src/helpers.js";

process.env.FIRECRAWL_API_KEY ??= "fc-selfhosted";
process.env.FIRECRAWL_BASE_URL ??= "http://localhost:3002";

const failedUrls = [
  // Null results from Phase H bulk test (concurrency 20) — 36 URLs
  // These are NOT 404s and NOT passing — they failed due to timeouts, bot blocks, or Gemini extraction failures

  // Shopify
  { url: "https://www.allbirds.com/products/mens-tree-runners", category: "Shopify / Shoes" },
  { url: "https://en.pitviper.es/products/the-actualbush-original-2-0", category: "Shopify / Sunglasses" },
  { url: "https://www.brooklinen.com/products/classic-core-sheet-set", category: "Shopify / Bedding" },
  { url: "https://www.mvmt.com/products/classic-black-tan", category: "Shopify / Watches" },
  { url: "https://www.nativecos.com/products/deodorant-stick", category: "Native / Personal care" },
  { url: "https://www.hydroflask.com/32-oz-wide-mouth", category: "Shopify / Bottles" },

  // Fashion / Apparel
  { url: "https://www.primark.com/es-es/p/pantalones-cortos-deportivos-de-malla-negro-991160590804", category: "Primark / Shorts" },
  { url: "https://www.zara.com/us/en/cotton-t-shirt-p00722325.html", category: "Zara / T-shirt" },
  { url: "https://www2.hm.com/en_us/productpage.0970818001.html", category: "H&M / Apparel" },
  { url: "https://www.nike.com/t/air-max-90-mens-shoes-6n3vKB/CN8490-001", category: "Nike / Shoes" },
  { url: "https://www.adidas.com/us/ultraboost-5-shoes/HQ6437.html", category: "Adidas / Shoes" },
  { url: "https://www.levi.com/US/en_US/clothing/men/jeans/511-slim-fit-mens-jeans/p/045115855", category: "Levi's / Jeans" },
  { url: "https://www.nordstrom.com/s/nike-dunk-low-retro-sneaker-men/6579130", category: "Nordstrom / Shoes" },
  { url: "https://www.gap.com/browse/product.do?pid=795187012", category: "Gap / Apparel" },

  // Electronics
  { url: "https://store.google.com/us/product/pixel_9", category: "Google / Phone" },

  // Home / Furniture
  { url: "https://www.wayfair.com/furniture/pdp/mercury-row-arviso-upholstered-platform-bed-w007705244.html", category: "Wayfair / Furniture" },
  { url: "https://www.cb2.com/taper-black-marble-side-table/s547916", category: "CB2 / Furniture" },
  { url: "https://www.westelm.com/products/mid-century-bedside-table-h433/", category: "West Elm / Furniture" },

  // Beauty / Skincare
  { url: "https://www.sephora.com/product/the-porefessional-face-primer-P264900", category: "Sephora / Makeup" },
  { url: "https://www.ulta.com/p/moisturizing-cream-body-face-moisturizer-xlsImpprod3530069", category: "Ulta / Skincare" },
  { url: "https://theordinary.com/en-us/hyaluronic-acid-2-b5-hydrating-serum-100098.html", category: "The Ordinary / Skincare" },
  { url: "https://glossier.com/products/boy-brow", category: "Glossier / Makeup" },

  // Sporting goods / Outdoor
  { url: "https://www.rei.com/product/171554/patagonia-better-sweater-fleece-jacket-mens", category: "REI / Outdoor" },
  { url: "https://www.yeti.com/drinkware/bottles/21071501392.html", category: "Yeti / Drinkware" },
  { url: "https://www.thenorthface.com/en-us/p/mens/mens-jackets-and-vests-211702/mens-terra-peak-jacket-NF0A88U2", category: "North Face / Jacket" },

  // Books / Media
  { url: "https://www.barnesandnoble.com/w/project-hail-mary-andy-weir/1137396811", category: "B&N / Book" },

  // Pet
  { url: "https://www.chewy.com/dp/54226", category: "Chewy / Pet food" },

  // Specialty / DTC
  { url: "https://casper.com/products/original-foam-v1", category: "Casper / Mattress" },
  { url: "https://www.away.com/suitcases/the-carry-on", category: "Away / Luggage" },
  { url: "https://www.aesop.com/us/p/skin/hydrate/camellia-nut-facial-hydrating-cream/", category: "Aesop / Skincare" },
  { url: "https://www.dyson.com/vacuum-cleaners/cordless/v15/detect-yellow", category: "Dyson / Vacuum" },

  // Supplements / Health
  { url: "https://www.iherb.com/pr/nature-s-way-alive-once-daily-multi-vitamin-ultra-potency-60-tablets/14811", category: "iHerb / Vitamins" },
  { url: "https://athleticgreens.com/en", category: "AG1 / Supplements" },

  // Marketplace
  { url: "https://www.etsy.com/listing/1230170206/personalized-18k-gold-square-pendant", category: "Etsy / Jewelry" },
  { url: "https://www.walmart.com/ip/LEGO-Star-Wars-Revenge-Sith-ARC-170-Starfighter-Spaceship-Building-Toy-Kids-Star-Wars-Toy-Boys-Girls-Ages-9-Gift-Idea-Birthdays-75402/6772304218", category: "Walmart / Toys" },
  { url: "https://www.costco.com/kirkland-signature-organic-extra-virgin-olive-oil%2C-2-l.product.100334841.html", category: "Costco / Grocery" },
];

const CONCURRENCY = parseInt(process.env.BULK_TEST_CONCURRENCY ?? "1", 10);

interface TestResult {
  url: string;
  category: string;
  success: boolean;
  name?: string;
  price?: string;
  priceValid: boolean;
  notFound: boolean;
  error?: string;
  durationMs: number;
}

async function runTest(entry: { url: string; category: string }): Promise<TestResult> {
  const start = Date.now();
  try {
    const result = await discoverViaFirecrawl(entry.url);
    const durationMs = Date.now() - start;
    if (!result) {
      return { url: entry.url, category: entry.category, success: false, priceValid: false, notFound: false, error: "null result", durationMs };
    }
    if (result.error === "product_not_found") {
      return { url: entry.url, category: entry.category, success: false, priceValid: false, notFound: true, error: "product not found / discontinued", durationMs };
    }
    const priceValid = isValidPrice(result.price);
    return {
      url: entry.url, category: entry.category, success: priceValid,
      name: result.name, price: result.price, priceValid, notFound: false,
      error: priceValid ? undefined : `invalid price: "${result.price}"`,
      durationMs,
    };
  } catch (err: any) {
    return { url: entry.url, category: entry.category, success: false, priceValid: false, notFound: false, error: err?.message ?? String(err), durationMs: Date.now() - start };
  }
}

async function main() {
  console.log(`\n=== Re-test Previously Failed URLs ===`);
  console.log(`URLs: ${failedUrls.length} (all previously failed) | Concurrency: ${CONCURRENCY}\n`);

  const results: TestResult[] = [];
  const queue = [...failedUrls];

  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    const batchResults = await Promise.all(batch.map(runTest));
    for (const r of batchResults) {
      results.push(r);
      const status = r.notFound ? "404" : r.success ? "NEW PASS" : "FAIL";
      const priceStr = r.price ? ` $${r.price}` : "";
      const nameStr = r.name ? ` "${r.name.slice(0, 50)}"` : "";
      const errStr = r.error ? ` (${r.error.slice(0, 60)})` : "";
      console.log(
        `[${String(results.length).padStart(2)}/${failedUrls.length}] ${status.padEnd(8)} ${(r.durationMs / 1000).toFixed(1).padStart(5)}s  ${r.category.padEnd(30)}${nameStr}${priceStr}${errStr}`,
      );
    }
  }

  const newPasses = results.filter((r) => r.success);
  const notFoundResults = results.filter((r) => r.notFound);
  const stillFailing = results.filter((r) => !r.success && !r.notFound);
  const nullResults = stillFailing.filter((r) => r.error === "null result");
  const badPrices = stillFailing.filter((r) => r.error?.startsWith("invalid price"));
  const errors = stillFailing.filter((r) => r.error !== "null result" && !r.error?.startsWith("invalid price"));
  const totalMs = results.reduce((a, r) => a + r.durationMs, 0);

  console.log(`\n=== Summary ===`);
  console.log(`Previously failed:  ${failedUrls.length}`);
  console.log(`Now passing:        ${newPasses.length} (${((newPasses.length / failedUrls.length) * 100).toFixed(0)}% recovery)`);
  console.log(`Not found/disc.:    ${notFoundResults.length}`);
  console.log(`Still failing:      ${stillFailing.length}`);
  console.log(`  Null result:      ${nullResults.length}`);
  console.log(`  Bad price:        ${badPrices.length}`);
  console.log(`  Errors:           ${errors.length}`);
  console.log(`Total time:         ${(totalMs / 1000).toFixed(0)}s`);
  console.log(`\nProjected overall:  ${10 + newPasses.length}/61 (${(((10 + newPasses.length) / 61) * 100).toFixed(0)}%)`);

  if (newPasses.length > 0) {
    console.log(`\n--- Newly Passing ---`);
    for (const r of newPasses) {
      console.log(`  ${r.category}: "${r.name}" $${r.price}`);
    }
  }

  if (notFoundResults.length > 0) {
    console.log(`\n--- Not Found / Discontinued ---`);
    for (const f of notFoundResults) {
      console.log(`  [404] ${f.category}: ${f.url}`);
    }
  }

  if (stillFailing.length > 0) {
    console.log(`\n--- Still Failing ---`);
    for (const f of stillFailing) {
      const reason = f.error === "null result" ? "NULL" : f.error?.startsWith("invalid price") ? "BAD_PRICE" : "ERROR";
      console.log(`  [${reason}] ${f.category}: ${f.url}`);
    }
  }
}

main().catch(console.error);
