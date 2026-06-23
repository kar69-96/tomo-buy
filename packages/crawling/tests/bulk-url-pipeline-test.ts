/**
 * Full-pipeline bulk URL test: Firecrawl → Scrape → Exa → Browserbase.
 * Uses discoverProduct() from checkout, which exercises all 4 tiers.
 * Tracks which tier discovered each product.
 *
 * Usage: set -a && source .env && set +a && npx tsx packages/crawling/tests/bulk-url-pipeline-test.ts
 */

import { discoverProduct } from "../../checkout/src/discover.js";
import { isValidPrice } from "../src/helpers.js";
import type { FullDiscoveryResult } from "../src/discover.js";

// Defaults for self-hosted Firecrawl
process.env.FIRECRAWL_API_KEY ??= "fc-selfhosted";
process.env.FIRECRAWL_BASE_URL ??= "http://localhost:3002";

interface TestResult {
  url: string;
  category: string;
  success: boolean;
  name?: string;
  price?: string;
  method?: string;
  priceValid: boolean;
  nameValid: boolean;
  optionCount: number;
  options?: string[];
  error?: string;
  notFound: boolean;
  durationMs: number;
}

const urls: { url: string; category: string }[] = [
  // ---- Shopify stores ----
  { url: "https://www.allbirds.com/products/mens-tree-runners", category: "Shopify / Shoes" },
  { url: "https://en.pitviper.es/products/the-actualbush-original-2-0", category: "Shopify / Sunglasses" },
  { url: "https://www.gymshark.com/products/gymshark-adapt-camo-seamless-leggings-black-asphalt-grey-ss24", category: "Gymshark / Activewear" },
  { url: "https://www.brooklinen.com/products/classic-core-sheet-set", category: "Shopify / Bedding" },
  { url: "https://bombas.com/products/mens-merino-wool-socks", category: "Bombas / Socks" },
  { url: "https://ruggable.com/products/kamran-hazel-rug", category: "Ruggable / Rugs" },
  { url: "https://www.chubbiesshorts.com/products/the-business-executives-6-everywear-performance-short", category: "Chubbies / Shorts" },
  { url: "https://www.mvmt.com/products/classic-black-tan", category: "Shopify / Watches" },
  { url: "https://www.nativecos.com/products/deodorant-stick", category: "Native / Personal care" },
  { url: "https://www.hydroflask.com/32-oz-wide-mouth", category: "Shopify / Bottles" },

  // ---- Fashion / Apparel ----
  { url: "https://www.primark.com/es-es/p/pantalones-cortos-deportivos-de-malla-negro-991160590804", category: "Primark / Shorts" },
  { url: "https://www.zara.com/us/en/cotton-t-shirt-p00722325.html", category: "Zara / T-shirt" },
  { url: "https://www2.hm.com/en_us/productpage.0970818001.html", category: "H&M / Apparel" },
  { url: "https://www.uniqlo.com/us/en/products/E422992-000/00", category: "Uniqlo / Apparel" },
  { url: "https://www.nike.com/t/air-max-90-mens-shoes-6n3vKB/CN8490-001", category: "Nike / Shoes" },
  { url: "https://www.adidas.com/us/ultraboost-5-shoes/HQ6437.html", category: "Adidas / Shoes" },
  { url: "https://www.levi.com/US/en_US/clothing/men/jeans/511-slim-fit-mens-jeans/p/045115855", category: "Levi's / Jeans" },
  { url: "https://www.nordstrom.com/s/nike-dunk-low-retro-sneaker-men/6579130", category: "Nordstrom / Shoes" },
  { url: "https://www.gap.com/browse/product.do?pid=795187012", category: "Gap / Apparel" },

  // ---- Electronics ----
  { url: "https://www.apple.com/shop/buy-iphone/iphone-16", category: "Apple / Phone" },
  { url: "https://www.samsung.com/us/smartphones/galaxy-s25-ultra/", category: "Samsung / Phone" },
  { url: "https://store.google.com/us/product/pixel_9", category: "Google / Phone" },
  { url: "https://www.bose.com/p/headphones/quietcomfort-acoustic-noise-cancelling-headphones/QC-HEADPHONEARN.html", category: "Bose / Headphones" },
  { url: "https://electronics.sony.com/audio/headphones/headband/p/wh1000xm5-b", category: "Sony / Headphones" },
  { url: "https://www.logitech.com/en-us/products/mice/mx-master-3s.910-006557.html", category: "Logitech / Mouse" },
  { url: "https://www.anker.com/products/a2688-anker-prime-charger-100w-3-ports-gan", category: "Anker / Charger" },

  // ---- Home / Furniture ----
  { url: "https://www.ikea.com/us/en/p/kallax-shelf-unit-white-00275848/", category: "IKEA / Furniture" },
  { url: "https://www.wayfair.com/furniture/pdp/mercury-row-arviso-upholstered-platform-bed-w007705244.html", category: "Wayfair / Furniture" },
  { url: "https://www.cb2.com/taper-black-marble-side-table/s547916", category: "CB2 / Furniture" },
  { url: "https://www.westelm.com/products/mid-century-bedside-table-h433/", category: "West Elm / Furniture" },

  // ---- Grocery / Food ----
  { url: "https://www.vitacost.com/pacific-foods-organic-oat-plant-based-beverage-original", category: "Vitacost / Grocery" },
  { url: "https://www.thrive.market/p/primal-kitchen-classic-bbq-sauce", category: "Thrive / Food" },

  // ---- Beauty / Skincare ----
  { url: "https://www.sephora.com/product/the-porefessional-face-primer-P264900", category: "Sephora / Makeup" },
  { url: "https://www.ulta.com/p/moisturizing-cream-body-face-moisturizer-xlsImpprod3530069", category: "Ulta / Skincare" },
  { url: "https://theordinary.com/en-us/hyaluronic-acid-2-b5-hydrating-serum-100098.html", category: "The Ordinary / Skincare" },
  { url: "https://www.cerave.com/skincare/moisturizers/moisturizing-cream", category: "CeraVe / Skincare" },
  { url: "https://glossier.com/products/boy-brow", category: "Glossier / Makeup" },

  // ---- Sporting goods / Outdoor ----
  { url: "https://www.rei.com/product/171554/patagonia-better-sweater-fleece-jacket-mens", category: "REI / Outdoor" },
  { url: "https://www.patagonia.com/product/mens-nano-puff-jacket/84212.html", category: "Patagonia / Jacket" },
  { url: "https://www.yeti.com/drinkware/bottles/21071501392.html", category: "Yeti / Drinkware" },
  { url: "https://www.thenorthface.com/en-us/p/mens/mens-jackets-and-vests-211702/mens-terra-peak-jacket-NF0A88U2", category: "North Face / Jacket" },

  // ---- Books / Media ----
  { url: "https://bookshop.org/p/books/atomic-habits-james-clear/7244448", category: "Bookshop / Book" },
  { url: "https://www.barnesandnoble.com/w/project-hail-mary-andy-weir/1137396811", category: "B&N / Book" },

  // ---- Pet ----
  { url: "https://www.chewy.com/dp/54226", category: "Chewy / Pet food" },

  // ---- Specialty / DTC ----
  { url: "https://www.warbyparker.com/eyeglasses/women/durand/crystal", category: "Warby Parker / Glasses" },
  { url: "https://casper.com/products/original-foam-v1", category: "Casper / Mattress" },
  { url: "https://www.away.com/suitcases/the-carry-on", category: "Away / Luggage" },
  { url: "https://www.everlane.com/products/mens-surplus-tee-black", category: "Everlane / Apparel" },
  { url: "https://www.aesop.com/us/p/skin/hydrate/camellia-nut-facial-hydrating-cream/", category: "Aesop / Skincare" },
  { url: "https://www.lego.com/en-us/product/eiffel-tower-10307", category: "Lego / Toys" },
  { url: "https://www.dyson.com/vacuum-cleaners/cordless/v15/detect-yellow", category: "Dyson / Vacuum" },

  // ---- International ----
  { url: "https://www.asos.com/us/asos-design/asos-design-essential-oversized-t-shirt-in-white/prd/22190826", category: "ASOS / Apparel" },
  { url: "https://www.decathlon.com/products/compact-waterproof-20-liter-backpack-travel-100-309854", category: "Decathlon / Outdoor" },
  { url: "https://www.muji.us/products/ultrasonic-aroma-diffuser", category: "Muji / Home" },

  // ---- Supplements / Health ----
  { url: "https://www.iherb.com/pr/nature-s-way-alive-once-daily-multi-vitamin-ultra-potency-60-tablets/14811", category: "iHerb / Vitamins" },
  { url: "https://athleticgreens.com/en", category: "AG1 / Supplements" },

  // ---- Marketplace ----
  { url: "https://www.etsy.com/listing/1230170206/personalized-18k-gold-square-pendant", category: "Etsy / Jewelry" },
  { url: "https://www.ebay.com/itm/406220954296", category: "eBay / Marketplace" },
  { url: "https://www.target.com/p/apple-airpods-max-midnight/-/A-85978621", category: "Target / Electronics" },
  { url: "https://www.walmart.com/ip/LEGO-Star-Wars-Revenge-Sith-ARC-170-Starfighter-Spaceship-Building-Toy-Kids-Star-Wars-Toy-Boys-Girls-Ages-9-Gift-Idea-Birthdays-75402/6772304218", category: "Walmart / Toys" },
  { url: "https://www.costco.com/kirkland-signature-organic-extra-virgin-olive-oil%2C-2-l.product.100334841.html", category: "Costco / Grocery" },
];

const CONCURRENCY = parseInt(process.env.BULK_TEST_CONCURRENCY ?? "1", 10);

async function runTest(
  entry: { url: string; category: string },
): Promise<TestResult> {
  const start = Date.now();
  try {
    const result: FullDiscoveryResult = await discoverProduct(entry.url);
    const durationMs = Date.now() - start;

    if (result.error === "product_not_found") {
      return {
        url: entry.url,
        category: entry.category,
        success: false,
        method: result.method,
        priceValid: false,
        nameValid: false,
        optionCount: 0,
        notFound: true,
        error: "product not found / discontinued",
        durationMs,
      };
    }

    const priceValid = isValidPrice(result.price);
    const nameValid = Boolean(result.name && result.name.trim().length >= 3);
    return {
      url: entry.url,
      category: entry.category,
      success: priceValid && nameValid,
      name: result.name,
      price: result.price,
      method: result.method,
      priceValid,
      nameValid,
      optionCount: result.options.length,
      options: result.options.map(
        (o) => `${o.name}: [${o.values.join(", ")}]`,
      ),
      notFound: false,
      error: !priceValid
        ? `invalid price: "${result.price}"`
        : !nameValid
          ? "invalid name"
          : undefined,
      durationMs,
    };
  } catch (err: any) {
    return {
      url: entry.url,
      category: entry.category,
      success: false,
      priceValid: false,
      nameValid: false,
      optionCount: 0,
      notFound: false,
      error: err?.message?.slice(0, 120) ?? String(err).slice(0, 120),
      durationMs: Date.now() - start,
    };
  }
}

async function main() {
  const exaKey = process.env.EXA_API_KEY;
  console.log(`\n=== Full Pipeline Bulk URL Test ===`);
  console.log(`URLs: ${urls.length} | Concurrency: ${CONCURRENCY}`);
  console.log(`Exa: ${exaKey ? "ENABLED" : "DISABLED (no EXA_API_KEY)"}\n`);

  const results: TestResult[] = [];
  const queue = [...urls];

  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    const batchResults = await Promise.all(batch.map(runTest));
    for (const r of batchResults) {
      results.push(r);
      const status = r.notFound ? "404" : r.success ? "OK" : "FAIL";
      const methodTag = r.method ? `[${r.method}]` : "";
      const optStr = r.optionCount > 0 ? ` (${r.optionCount} opts)` : "";
      const priceStr = r.price ? ` $${r.price}` : "";
      const nameStr = r.name ? ` "${r.name.slice(0, 45)}"` : "";
      const errStr = !r.success && !r.notFound ? ` ERR: ${(r.error ?? "").slice(0, 50)}` : "";
      console.log(
        `[${String(results.length).padStart(2)}/${urls.length}] ${status.padEnd(4)} ${(r.durationMs / 1000).toFixed(1).padStart(6)}s  ${methodTag.padEnd(14)} ${r.category.padEnd(28)}${nameStr}${priceStr}${optStr}${errStr}`,
      );
    }
  }

  // Summary
  const passed = results.filter((r) => r.success);
  const notFoundResults = results.filter((r) => r.notFound);
  const failed = results.filter((r) => !r.success && !r.notFound);
  const methodCounts = results.reduce<Record<string, number>>((acc, r) => {
    const key = r.method ?? "none";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const passedMethodCounts = passed.reduce<Record<string, number>>((acc, r) => {
    const key = r.method ?? "none";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const totalMs = results.reduce((a, r) => a + r.durationMs, 0);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`RESULTS SUMMARY`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Total:          ${results.length}`);
  console.log(`Passed:         ${passed.length} (${((passed.length / results.length) * 100).toFixed(0)}%)`);
  console.log(`Not Found:      ${notFoundResults.length}`);
  console.log(`Failed:         ${failed.length}`);
  console.log(`Total Time:     ${(totalMs / 1000).toFixed(0)}s`);

  console.log(`\n--- Discovery Method Breakdown (all) ---`);
  for (const [method, count] of Object.entries(methodCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${method.padEnd(15)} ${count}`);
  }

  console.log(`\n--- Discovery Method Breakdown (passed only) ---`);
  for (const [method, count] of Object.entries(passedMethodCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${method.padEnd(15)} ${count}`);
  }

  // Exa-specific results
  const exaResults = results.filter((r) => r.method === "exa");
  if (exaResults.length > 0) {
    console.log(`\n--- Exa.ai Results (${exaResults.length} URLs) ---`);
    for (const r of exaResults) {
      const status = r.success ? "OK" : "FAIL";
      console.log(`  [${status}] ${r.category}: ${r.name ?? "?"} — $${r.price ?? "?"} (${(r.durationMs / 1000).toFixed(1)}s)`);
    }
  } else {
    console.log(`\n--- No URLs discovered via Exa ---`);
    if (!exaKey) console.log(`  (EXA_API_KEY not set — tier was skipped)`);
  }

  // Failed URLs
  if (failed.length > 0) {
    console.log(`\n--- Failed URLs ---`);
    for (const f of failed) {
      console.log(`  ${f.category.padEnd(28)} ${f.error?.slice(0, 80)}`);
    }
  }
}

main().catch(console.error);
