/**
 * Bulk URL test for Firecrawl discovery pipeline.
 * Tests ~60 product URLs across a wide spectrum of sites.
 *
 * Usage: npx tsx packages/crawling/tests/bulk-url-test.ts
 */

import {
  discoverViaFirecrawlWithDiagnostics,
  type DiscoveryFailureCode,
} from "../src/discover.js";
import { isValidPrice } from "../src/helpers.js";
import type { FullDiscoveryResult } from "../src/discover.js";

// Set env vars if not already set
process.env.FIRECRAWL_API_KEY ??= "fc-selfhosted";
process.env.FIRECRAWL_BASE_URL ??= "http://localhost:3002";

interface TestResult {
  url: string;
  category: string;
  success: boolean;
  name?: string;
  price?: string;
  method?: string;
  failureCode?: DiscoveryFailureCode;
  failureStage?: string;
  failureDetail?: string;
  timingTotalMs?: number;
  timingFirecrawlMs?: number;
  timingFirecrawlAttempts?: number;
  timingBrowserbaseMs?: number;
  timingVariantMs?: number;
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
  { url: "https://www.gymshark.com/products/gymshark-running-elite-race-vest-sleeveless-tops-black-ss25", category: "Gymshark / Activewear" },
  { url: "https://www.brooklinen.com/products/classic-core-sheet-set", category: "Shopify / Bedding" },
  { url: "https://bombas.com/products/mens-merino-wool-socks", category: "Bombas / Socks" },
  { url: "https://ruggable.com/products/kamran-hazel-rug", category: "Ruggable / Rugs" },
  { url: "https://www.chubbiesshorts.com/products/the-shadowstorms-5-5-originals", category: "Chubbies / Shorts" },
  { url: "https://www.mvmt.com/new-arrivals-4/napa-red/28000548.html", category: "MVMT / Watches" },
  { url: "https://www.nativecos.com/products/deodorant-stick", category: "Native / Personal care" },
  { url: "https://www.hydroflask.com/32-oz-wide-mouth", category: "Shopify / Bottles" },

  // ---- Fashion / Apparel ----
  { url: "https://www.primark.com/es-es/p/pantalones-cortos-deportivos-de-malla-negro-991160590804", category: "Primark / Shorts" },
  { url: "https://www.zara.com/us/en/rustic-cotton-t-shirt-p04424306.html?v1=504236252", category: "Zara / T-shirt" },
  { url: "https://www2.hm.com/en_us/productpage.0970818001.html", category: "H&M / Apparel" },
  { url: "https://www.uniqlo.com/us/en/products/E422992-000/00", category: "Uniqlo / Apparel" },
  { url: "https://www.nike.com/t/air-max-90-mens-shoes-6n3vKB/CN8490-001", category: "Nike / Shoes" },
  { url: "https://www.adidas.com/us/samba-jane-shoes/JR1402.html", category: "Adidas / Shoes" },
  { url: "https://www.levi.com/US/en_US/clothing/men/jeans/511-slim-fit-mens-jeans/p/045115855", category: "Levi's / Jeans" },
  { url: "https://www.nordstrom.com/s/air-force-1-07-basketball-sneaker-men/4680267", category: "Nordstrom / Shoes" },
  { url: "https://www.gap.com/browse/product.do?pid=706174002", category: "Gap / Apparel" },

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
  { url: "https://www.primalkitchen.com/products/classic-unsweetened-organic-bbq-sauce", category: "Primal Kitchen / Food" },

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
  { url: "https://bookshop.org/p/books/atomic-habits-an-easy-proven-way-to-build-good-habits-break-bad-ones-james-clear/072529306f5772fe", category: "Bookshop / Book" },
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
  { url: "https://www.iherb.com/pr/nature-s-way-alive-men-s-ultra-multivitamin-60-tablets/37794", category: "iHerb / Vitamins" },
  { url: "https://athleticgreens.com/en", category: "AG1 / Supplements" },

  // ---- Marketplace ----
  { url: "https://www.etsy.com/listing/1230170206/personalized-18k-gold-square-pendant", category: "Etsy / Jewelry" },
  { url: "https://www.ebay.com/itm/406220954296", category: "eBay / Marketplace" },
  { url: "https://www.target.com/p/apple-airpods-max-midnight/-/A-85978621", category: "Target / Electronics" },
  { url: "https://www.walmart.com/ip/LEGO-Star-Wars-Revenge-Sith-ARC-170-Starfighter-Spaceship-Building-Toy-Kids-Star-Wars-Toy-Boys-Girls-Ages-9-Gift-Idea-Birthdays-75402/6772304218", category: "Walmart / Toys" },
  { url: "https://www.costco.com/kirkland-signature-organic-extra-virgin-olive-oil%2C-2-l.product.100334841.html", category: "Costco / Grocery" },
];

// Set to 1 when using Browserbase adapter (Dev plan = 1 concurrent session)
const CONCURRENCY = parseInt(process.env.BULK_TEST_CONCURRENCY ?? "3", 10);

async function runTest(
  entry: { url: string; category: string },
): Promise<TestResult> {
  const start = Date.now();
  try {
    const { result, diagnostics } = await discoverViaFirecrawlWithDiagnostics(
      entry.url,
    );
    const durationMs = Date.now() - start;
    if (!result) {
      return {
        url: entry.url,
        category: entry.category,
        success: false,
        priceValid: false,
        nameValid: false,
        optionCount: 0,
        notFound: false,
        error: "null result",
        failureCode: diagnostics.failureCode,
        failureStage: diagnostics.failureStage,
        failureDetail: diagnostics.failureDetail,
        timingTotalMs: diagnostics.timings?.totalMs,
        timingFirecrawlMs: diagnostics.timings?.firecrawlMs,
        timingFirecrawlAttempts: diagnostics.timings?.firecrawlAttempts,
        timingBrowserbaseMs: diagnostics.timings?.browserbaseMs,
        timingVariantMs: diagnostics.timings?.variantMs,
        durationMs,
      };
    }
    if (result.error === "product_not_found") {
      return {
        url: entry.url,
        category: entry.category,
        success: false,
        priceValid: false,
        nameValid: false,
        optionCount: 0,
        notFound: true,
        error: "product not found / discontinued",
        failureCode: diagnostics.failureCode ?? result.failure_code,
        failureStage: diagnostics.failureStage ?? result.failure_stage,
        failureDetail: diagnostics.failureDetail ?? result.failure_detail,
        timingTotalMs: diagnostics.timings?.totalMs,
        timingFirecrawlMs: diagnostics.timings?.firecrawlMs,
        timingFirecrawlAttempts: diagnostics.timings?.firecrawlAttempts,
        timingBrowserbaseMs: diagnostics.timings?.browserbaseMs,
        timingVariantMs: diagnostics.timings?.variantMs,
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
      failureCode: diagnostics.failureCode,
      failureStage: diagnostics.failureStage,
      failureDetail: diagnostics.failureDetail,
      timingTotalMs: diagnostics.timings?.totalMs,
      timingFirecrawlMs: diagnostics.timings?.firecrawlMs,
      timingFirecrawlAttempts: diagnostics.timings?.firecrawlAttempts,
      timingBrowserbaseMs: diagnostics.timings?.browserbaseMs,
      timingVariantMs: diagnostics.timings?.variantMs,
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
      error: err?.message ?? String(err),
      durationMs: Date.now() - start,
    };
  }
}

async function main() {
  console.log(`\n=== Firecrawl Bulk URL Test ===`);
  console.log(`URLs: ${urls.length} | Concurrency: ${CONCURRENCY}\n`);

  const results: TestResult[] = [];
  const queue = [...urls];

  // Process in batches
  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    const batchResults = await Promise.all(batch.map(runTest));
    for (const r of batchResults) {
      results.push(r);
      const status = r.notFound ? "404" : r.success ? "OK" : "FAIL";
      const optStr = r.optionCount > 0 ? ` [${r.optionCount} options]` : "";
      const priceStr = r.price ? ` $${r.price}` : "";
      const nameStr = r.name ? ` "${r.name.slice(0, 50)}"` : "";
      const errStr = r.error ? ` (${r.error.slice(0, 60)})` : "";
      console.log(
        `[${String(results.length).padStart(2)}/${urls.length}] ${status.padEnd(4)} ${(r.durationMs / 1000).toFixed(1).padStart(5)}s  ${r.category.padEnd(30)}${nameStr}${priceStr}${optStr}${errStr}`,
      );
    }
  }

  // Summary
  const passed = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const notFoundResults = failed.filter((r) => r.notFound);
  const nullResults = failed.filter((r) => !r.notFound && r.error === "null result");
  const invalidPrice = failed.filter((r) => !r.notFound && r.error?.startsWith("invalid price"));
  const invalidName = failed.filter((r) => !r.notFound && r.error === "invalid name");
  const thrownErrors = failed.filter(
    (r) =>
      !r.notFound
      && r.error !== "null result"
      && !r.error?.startsWith("invalid price")
      && r.error !== "invalid name",
  );
  const withOptions = results.filter((r) => r.optionCount > 0);
  const totalMs = results.reduce((a, r) => a + r.durationMs, 0);
  const sortedDurations = [...results.map((r) => r.durationMs)].sort((a, b) => a - b);
  const percentile = (p: number): number => {
    const idx = Math.min(
      sortedDurations.length - 1,
      Math.max(0, Math.ceil((p / 100) * sortedDurations.length) - 1),
    );
    return sortedDurations[idx] ?? 0;
  };
  const avgTime = totalMs / results.length;
  const p50 = percentile(50);
  const p95 = percentile(95);
  const p99 = percentile(99);
  const fastest = Math.min(...results.map((r) => r.durationMs));
  const slowest = Math.max(...results.map((r) => r.durationMs));
  const methodCounts = results.reduce<Record<string, number>>((acc, r) => {
    const key = r.method ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const failureCodeCounts = failed.reduce<Record<string, number>>((acc, r) => {
    const key = r.failureCode ?? (r.notFound ? "not_found" : "unknown");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const avg = (values: number[]): number =>
    values.length > 0
      ? values.reduce((a, b) => a + b, 0) / values.length
      : 0;
  const avgFirecrawlMs = avg(
    results
      .map((r) => r.timingFirecrawlMs)
      .filter((v): v is number => typeof v === "number"),
  );
  const avgBrowserbaseMs = avg(
    results
      .map((r) => r.timingBrowserbaseMs)
      .filter((v): v is number => typeof v === "number" && v > 0),
  );
  const avgVariantMs = avg(
    results
      .map((r) => r.timingVariantMs)
      .filter((v): v is number => typeof v === "number" && v > 0),
  );
  const avgFirecrawlAttempts = avg(
    results
      .map((r) => r.timingFirecrawlAttempts)
      .filter((v): v is number => typeof v === "number"),
  );

  console.log(`\n=== Summary ===`);
  console.log(`Total:        ${results.length}`);
  console.log(`Passed:       ${passed.length} (${((passed.length / results.length) * 100).toFixed(0)}%)`);
  console.log(`Failed:       ${failed.length}`);
  console.log(`  Not found:    ${notFoundResults.length}`);
  console.log(`  Null result:  ${nullResults.length}`);
  console.log(`  Bad price:    ${invalidPrice.length}`);
  console.log(`  Bad name:     ${invalidName.length}`);
  console.log(`  Errors:       ${thrownErrors.length}`);
  console.log(`W/ Options:   ${withOptions.length}`);
  console.log(`Avg Time:     ${(avgTime / 1000).toFixed(1)}s`);
  console.log(`P50 Time:     ${(p50 / 1000).toFixed(1)}s`);
  console.log(`P95 Time:     ${(p95 / 1000).toFixed(1)}s`);
  console.log(`P99 Time:     ${(p99 / 1000).toFixed(1)}s`);
  console.log(`Fastest:      ${(fastest / 1000).toFixed(1)}s`);
  console.log(`Slowest:      ${(slowest / 1000).toFixed(1)}s`);
  console.log(`Total Time:   ${(totalMs / 1000).toFixed(0)}s`);
  console.log(
    `Methods:      ${Object.entries(methodCounts)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`,
  );
  console.log(
    `Failure codes:${Object.entries(failureCodeCounts)
      .map(([k, v]) => ` ${k}=${v}`)
      .join(",")}`,
  );
  console.log(`Avg stage ms: firecrawl=${avgFirecrawlMs.toFixed(1)}, browserbase=${avgBrowserbaseMs.toFixed(1)}, variant=${avgVariantMs.toFixed(1)}`);
  console.log(`Avg firecrawl attempts: ${avgFirecrawlAttempts.toFixed(2)}`);

  if (notFoundResults.length > 0) {
    console.log(`\n--- Not Found / Discontinued ---`);
    for (const f of notFoundResults) {
      console.log(`  [404] ${(f.durationMs / 1000).toFixed(1).padStart(5)}s  ${f.category}: ${f.url}`);
    }
  }

  const otherFailed = failed.filter((r) => !r.notFound);
  if (otherFailed.length > 0) {
    console.log(`\n--- Failed URLs ---`);
    for (const f of otherFailed) {
      const reason = f.error === "null result"
        ? "NULL"
        : f.error?.startsWith("invalid price")
          ? "BAD_PRICE"
          : f.error === "invalid name"
            ? "BAD_NAME"
          : "ERROR";
      console.log(`  [${reason}] ${(f.durationMs / 1000).toFixed(1).padStart(5)}s  ${f.category}: ${f.url}`);
      if (f.failureCode || f.failureStage) {
        console.log(
          `         code=${f.failureCode ?? "unknown"} stage=${f.failureStage ?? "unknown"}`,
        );
      }
      if (typeof f.timingFirecrawlMs === "number") {
        console.log(
          `         timing_ms total=${f.timingTotalMs ?? 0} firecrawl=${f.timingFirecrawlMs} browserbase=${f.timingBrowserbaseMs ?? 0} variant=${f.timingVariantMs ?? 0} attempts=${f.timingFirecrawlAttempts ?? 0}`,
        );
      }
      if (f.failureDetail) {
        console.log(`         detail=${f.failureDetail.slice(0, 160)}`);
      }
      if (reason === "ERROR") console.log(`         ${f.error}`);
    }
  }

  if (withOptions.length > 0) {
    console.log(`\n--- URLs with Options ---`);
    for (const r of withOptions) {
      console.log(`  ${r.category}: ${r.name}`);
      for (const o of r.options ?? []) {
        console.log(`    ${o}`);
      }
    }
  }
}

main().catch(console.error);
