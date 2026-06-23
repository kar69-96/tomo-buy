/**
 * Bulk URL test against the /api/query endpoint.
 * Measures timings, accuracy, and discovery methods.
 *
 * Usage: BLOON_API_URL=http://localhost:3001 npx tsx packages/crawling/tests/bulk-query-endpoint-test.ts
 */

const API_URL = process.env.BLOON_API_URL ?? "http://localhost:3001";
const CONCURRENCY = parseInt(process.env.BULK_TEST_CONCURRENCY ?? "3", 10);

interface QueryResult {
  product: {
    name: string;
    url: string;
    price: string;
    image_url?: string;
    currency?: string;
    brand?: string;
    source: string;
  };
  options: { name: string; values: string[] }[];
  required_fields: { field: string; label: string }[];
  route: string;
  discovery_method: string;
}

interface TestResult {
  url: string;
  category: string;
  success: boolean;
  name?: string;
  price?: string;
  route?: string;
  discoveryMethod?: string;
  optionCount: number;
  httpStatus?: number;
  error?: string;
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

  // ---- Pet ----

  // ---- Specialty / DTC ----
  { url: "https://www.warbyparker.com/eyeglasses/women/durand/crystal", category: "Warby Parker / Glasses" },
  { url: "https://casper.com/products/original-foam-v1", category: "Casper / Mattress" },
  { url: "https://www.everlane.com/products/mens-surplus-tee-black", category: "Everlane / Apparel" },
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
  { url: "https://www.target.com/p/apple-airpods-max-midnight/-/A-85978621", category: "Target / Electronics" },
  { url: "https://www.walmart.com/ip/LEGO-Star-Wars-Revenge-Sith-ARC-170-Starfighter-Spaceship-Building-Toy-Kids-Star-Wars-Toy-Boys-Girls-Ages-9-Gift-Idea-Birthdays-75402/6772304218", category: "Walmart / Toys" },
  { url: "https://www.costco.com/kirkland-signature-organic-extra-virgin-olive-oil%2C-2-l.product.100334841.html", category: "Costco / Grocery" },
];

function isValidPrice(price: string | undefined): boolean {
  if (!price) return false;
  const cleaned = price.replace(/[$,€£¥]/g, "").trim();
  const num = parseFloat(cleaned);
  return !isNaN(num) && num > 0;
}

async function runTest(entry: { url: string; category: string }): Promise<TestResult> {
  const start = Date.now();
  try {
    const res = await fetch(`${API_URL}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: entry.url }),
      signal: AbortSignal.timeout(300_000),
    });
    const durationMs = Date.now() - start;
    const body = await res.json() as any;

    if (!res.ok) {
      return {
        url: entry.url,
        category: entry.category,
        success: false,
        httpStatus: res.status,
        optionCount: 0,
        error: body?.error?.message ?? `HTTP ${res.status}`,
        durationMs,
      };
    }

    const product = body.product;
    const priceValid = isValidPrice(product?.price);
    const nameValid = Boolean(product?.name && product.name.trim().length >= 3);

    return {
      url: entry.url,
      category: entry.category,
      success: priceValid && nameValid,
      name: product?.name,
      price: product?.price,
      route: body.route,
      discoveryMethod: body.discovery_method,
      optionCount: body.options?.length ?? 0,
      httpStatus: res.status,
      error: !priceValid
        ? `invalid price: "${product?.price}"`
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
      optionCount: 0,
      error: err?.message ?? String(err),
      durationMs: Date.now() - start,
    };
  }
}

async function main() {
  console.log(`\n=== Query Endpoint Bulk URL Test ===`);
  console.log(`API: ${API_URL}/api/query`);
  console.log(`URLs: ${urls.length} | Concurrency: ${CONCURRENCY}\n`);

  const results: TestResult[] = [];
  const queue = [...urls];

  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    const batchResults = await Promise.all(batch.map(runTest));
    for (const r of batchResults) {
      results.push(r);
      const status = r.success ? "OK" : "FAIL";
      const priceStr = r.price ? ` $${r.price}` : "";
      const nameStr = r.name ? ` "${r.name.slice(0, 50)}"` : "";
      const methodStr = r.discoveryMethod ? ` [${r.discoveryMethod}]` : "";
      const routeStr = r.route ? ` (${r.route})` : "";
      const optStr = r.optionCount > 0 ? ` {${r.optionCount} opts}` : "";
      const errStr = !r.success && r.error ? ` ERR: ${r.error.slice(0, 60)}` : "";
      console.log(
        `[${String(results.length).padStart(2)}/${urls.length}] ${status.padEnd(4)} ${(r.durationMs / 1000).toFixed(1).padStart(6)}s  ${r.category.padEnd(28)}${nameStr}${priceStr}${methodStr}${routeStr}${optStr}${errStr}`,
      );
    }
  }

  // ---- Summary ----
  const passed = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const totalMs = results.reduce((a, r) => a + r.durationMs, 0);
  const sorted = [...results.map((r) => r.durationMs)].sort((a, b) => a - b);
  const pctl = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? 0;
  const avgMs = totalMs / results.length;

  // Successful-only timings
  const passedMs = passed.map((r) => r.durationMs).sort((a, b) => a - b);
  const avgPassedMs = passedMs.length > 0 ? passedMs.reduce((a, b) => a + b, 0) / passedMs.length : 0;
  const pctlPassed = (p: number) => passedMs[Math.min(passedMs.length - 1, Math.max(0, Math.ceil((p / 100) * passedMs.length) - 1))] ?? 0;

  // Method counts
  const methodCounts = results.reduce<Record<string, number>>((acc, r) => {
    const key = r.discoveryMethod ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  // Route counts
  const routeCounts = results.reduce<Record<string, number>>((acc, r) => {
    const key = r.route ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  // Avg time per method (successful only)
  const methodTimings: Record<string, number[]> = {};
  for (const r of passed) {
    const key = r.discoveryMethod ?? "unknown";
    (methodTimings[key] ??= []).push(r.durationMs);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`=== SUMMARY ===`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Total:           ${results.length}`);
  console.log(`Passed:          ${passed.length} (${((passed.length / results.length) * 100).toFixed(0)}%)`);
  console.log(`Failed:          ${failed.length}`);
  console.log(`W/ Options:      ${results.filter((r) => r.optionCount > 0).length}`);

  console.log(`\n--- All URLs Timing ---`);
  console.log(`Avg:             ${(avgMs / 1000).toFixed(1)}s`);
  console.log(`P50:             ${(pctl(50) / 1000).toFixed(1)}s`);
  console.log(`P95:             ${(pctl(95) / 1000).toFixed(1)}s`);
  console.log(`P99:             ${(pctl(99) / 1000).toFixed(1)}s`);
  console.log(`Fastest:         ${(Math.min(...sorted) / 1000).toFixed(1)}s`);
  console.log(`Slowest:         ${(Math.max(...sorted) / 1000).toFixed(1)}s`);
  console.log(`Total wall:      ${(totalMs / 1000).toFixed(0)}s`);

  console.log(`\n--- Successful URLs Timing ---`);
  console.log(`Avg:             ${(avgPassedMs / 1000).toFixed(1)}s`);
  console.log(`P50:             ${(pctlPassed(50) / 1000).toFixed(1)}s`);
  console.log(`P95:             ${(pctlPassed(95) / 1000).toFixed(1)}s`);
  console.log(`Fastest:         ${(Math.min(...passedMs) / 1000).toFixed(1)}s`);
  console.log(`Slowest:         ${(Math.max(...passedMs) / 1000).toFixed(1)}s`);

  console.log(`\n--- Discovery Methods ---`);
  for (const [method, count] of Object.entries(methodCounts).sort((a, b) => b[1] - a[1])) {
    const timings = methodTimings[method];
    const avgT = timings ? (timings.reduce((a, b) => a + b, 0) / timings.length / 1000).toFixed(1) : "n/a";
    console.log(`  ${method.padEnd(20)} ${String(count).padStart(3)} URLs   avg ${avgT}s`);
  }

  console.log(`\n--- Routes ---`);
  for (const [route, count] of Object.entries(routeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${route.padEnd(20)} ${count}`);
  }

  if (failed.length > 0) {
    console.log(`\n--- Failed URLs ---`);
    for (const f of failed) {
      console.log(`  [${f.httpStatus ?? "ERR"}] ${(f.durationMs / 1000).toFixed(1).padStart(6)}s  ${f.category}: ${f.url}`);
      if (f.error) console.log(`         ${f.error.slice(0, 120)}`);
    }
  }
}

main().catch(console.error);
