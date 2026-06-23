/**
 * Query endpoint (POST /api/query) bulk test.
 *
 * Hits the live API server with a wide variety of product URLs
 * and reports pass/fail for each.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   API_URL=http://localhost:8787 npx tsx packages/crawling/tests/query-endpoint-test.ts
 */

const API_URL = process.env.API_URL ?? "http://localhost:8787";
const CONCURRENCY = parseInt(process.env.QUERY_TEST_CONCURRENCY ?? "2", 10);
const TIMEOUT_MS = 120_000; // 2 min per request

interface QueryResult {
  url: string;
  category: string;
  success: boolean;
  httpStatus?: number;
  productName?: string;
  price?: string;
  route?: string;
  discoveryMethod?: string;
  optionCount: number;
  options?: string[];
  requiredFieldCount: number;
  error?: string;
  durationMs: number;
}

// ---- Existing bulk URLs (from bulk-url-test.ts) ----
const existingUrls: { url: string; category: string }[] = [
  // Shopify
  { url: "https://www.allbirds.com/products/mens-tree-runners", category: "Shopify / Shoes" },
  { url: "https://www.gymshark.com/products/gymshark-running-elite-race-vest-sleeveless-tops-black-ss25", category: "Gymshark / Activewear" },
  { url: "https://www.brooklinen.com/products/classic-core-sheet-set", category: "Shopify / Bedding" },
  { url: "https://bombas.com/products/mens-merino-wool-socks", category: "Bombas / Socks" },
  { url: "https://www.hydroflask.com/32-oz-wide-mouth", category: "Shopify / Bottles" },
  // Fashion
  { url: "https://www.nike.com/t/air-max-90-mens-shoes-6n3vKB/CN8490-001", category: "Nike / Shoes" },
  { url: "https://www.adidas.com/us/samba-jane-shoes/JR1402.html", category: "Adidas / Shoes" },
  { url: "https://www.uniqlo.com/us/en/products/E422992-000/00", category: "Uniqlo / Apparel" },
  // Electronics
  { url: "https://www.bose.com/p/headphones/quietcomfort-acoustic-noise-cancelling-headphones/QC-HEADPHONEARN.html", category: "Bose / Headphones" },
  { url: "https://www.logitech.com/en-us/products/mice/mx-master-3s.910-006557.html", category: "Logitech / Mouse" },
  { url: "https://www.anker.com/products/a2688-anker-prime-charger-100w-3-ports-gan", category: "Anker / Charger" },
  // Home
  { url: "https://www.ikea.com/us/en/p/kallax-shelf-unit-white-00275848/", category: "IKEA / Furniture" },
  // Beauty
  { url: "https://theordinary.com/en-us/hyaluronic-acid-2-b5-hydrating-serum-100098.html", category: "The Ordinary / Skincare" },
  { url: "https://glossier.com/products/boy-brow", category: "Glossier / Makeup" },
  // Outdoor
  { url: "https://www.patagonia.com/product/mens-nano-puff-jacket/84212.html", category: "Patagonia / Jacket" },
  { url: "https://www.yeti.com/drinkware/bottles/21071501392.html", category: "Yeti / Drinkware" },
  // Books
  { url: "https://bookshop.org/p/books/atomic-habits-an-easy-proven-way-to-build-good-habits-break-bad-ones-james-clear/072529306f5772fe", category: "Bookshop / Book" },
  // DTC
  { url: "https://www.lego.com/en-us/product/eiffel-tower-10307", category: "Lego / Toys" },
  { url: "https://www.dyson.com/vacuum-cleaners/cordless/v15/detect-yellow", category: "Dyson / Vacuum" },
  // Marketplace
  { url: "https://www.target.com/p/apple-airpods-max-midnight/-/A-85978621", category: "Target / Electronics" },
];

// ---- NEW URLs not in existing bulk tests ----
const newUrls: { url: string; category: string }[] = [
  // Tech accessories
  { url: "https://www.apple.com/shop/buy-mac/macbook-air", category: "Apple / Laptop" },
  { url: "https://www.razer.com/gaming-mice/razer-deathadder-v3/RZ01-04640100-R3U1", category: "Razer / Mouse" },
  { url: "https://www.corsair.com/us/en/p/pc-cases/cc-9011271-ww/3500x-mid-tower-atx-pc-case-black-cc-9011271-ww/", category: "Corsair / PC Case" },
  { url: "https://www.sonos.com/en-us/shop/era-100", category: "Sonos / Speaker" },
  { url: "https://store.steampowered.com/app/1086940/Baldurs_Gate_3/", category: "Steam / Game" },

  // Fashion (new brands)
  { url: "https://www.converse.com/shop/p/chuck-taylor-all-star/M9166.html", category: "Converse / Shoes" },
  { url: "https://www.newbalance.com/pd/574-core/ML574EVG.html", category: "New Balance / Shoes" },
  { url: "https://www.underarmour.com/en-us/p/tops-t-shirts/mens-ua-tech-2.0-short-sleeve/1326413.html", category: "Under Armour / T-Shirt" },
  { url: "https://www.puma.com/us/en/pd/suede-classic-xxi-sneakers/374915", category: "Puma / Shoes" },
  { url: "https://www.ralphlauren.com/men-clothing-polo-shirts/custom-slim-fit-mesh-polo-shirt/0042379539.html", category: "Ralph Lauren / Polo" },

  // Home & Kitchen
  { url: "https://www.williams-sonoma.com/products/le-creuset-signature-round-dutch-oven/", category: "Williams Sonoma / Dutch Oven" },
  { url: "https://www.potterybarn.com/products/farmhouse-candle-holder/", category: "Pottery Barn / Decor" },
  { url: "https://www.crateandbarrel.com/faye-cream-queen-bed/s624735", category: "Crate&Barrel / Furniture" },
  { url: "https://www.restoration-hardware.com/cloud-modular-sofa/prod23160164.html", category: "RH / Furniture" },

  // Health & Supplements
  { url: "https://www.gnc.com/whey-protein/362021.html", category: "GNC / Protein" },
  { url: "https://www.vitaminshoppe.com/p/optimum-nutrition-gold-standard-100-whey-protein/opt1009", category: "Vitamin Shoppe / Protein" },

  // Beauty (new)
  { url: "https://www.sephora.com/product/mini-lip-injection-extreme-instant-long-term-lip-plumper-P469658", category: "Sephora / Lip Plumper" },
  { url: "https://www.bath-body-works.com/p/japanese-cherry-blossom-fine-fragrance-mist-026177952.html", category: "Bath & Body Works / Fragrance" },
  { url: "https://www.kiehls.com/skincare/face-moisturizers/ultra-facial-cream/622.html", category: "Kiehl's / Moisturizer" },

  // Food & Beverage
  { url: "https://www.nespresso.com/us/en/order/capsules/vertuo/double-espresso-chiaro-vertuo", category: "Nespresso / Coffee" },
  { url: "https://www.bluebottlecoffee.com/us/en/shop/three-africas", category: "Blue Bottle / Coffee" },

  // Outdoor / Sport (new)
  { url: "https://www.columbia.com/p/mens-watertight-ii-rain-jacket-1533891.html", category: "Columbia / Rain Jacket" },
  { url: "https://www.thenorthface.com/en-us/p/mens/mens-jackets-and-vests-211702/mens-1996-retro-nuptse-jacket-NF0A3C8D", category: "North Face / Puffer" },
  { url: "https://www.osprey.com/atmos-ag-65-backpack", category: "Osprey / Backpack" },

  // Kids / Baby
  { url: "https://www.carters.com/product/baby-3-piece-little-character-set-v_1N048910.html", category: "Carter's / Baby" },

  // Luxury
  { url: "https://www.tiffany.com/jewelry/necklaces-pendants/return-to-tiffany-heart-tag-pendant-GRP00904/", category: "Tiffany / Jewelry" },

  // Subscription / Digital
  { url: "https://www.masterclass.com/classes/gordon-ramsay-teaches-cooking", category: "MasterClass / Course" },

  // Pet (new)
  { url: "https://www.petco.com/shop/en/petcostore/product/blue-buffalo-life-protection-formula-adult-chicken-and-brown-rice-recipe-dry-dog-food-3135765", category: "Petco / Dog Food" },

  // Auto / Tools
  { url: "https://www.homedepot.com/p/DEWALT-20V-MAX-Cordless-1-2-in-Drill-Driver-Kit-DCD771C2/204279858", category: "Home Depot / Drill" },

  // Stationery / Office
  { url: "https://www.muji.us/collections/pens-pencils/products/gel-ink-ballpoint-pen-0-38-d7a", category: "Muji / Pen" },

  // Gaming / Collectibles
  { url: "https://www.playstation.com/en-us/accessories/dualsense-wireless-controller/", category: "PlayStation / Controller" },
  { url: "https://www.nintendo.com/us/store/products/nintendo-switch-oled-model-white-set/", category: "Nintendo / Console" },

  // Watches
  { url: "https://www.fossil.com/en-us/products/machine-chronograph-smoke-stainless-steel-watch/FS4662.html", category: "Fossil / Watch" },
  { url: "https://www.garmin.com/en-US/p/884585", category: "Garmin / Smartwatch" },

  // Grocery DTC
  { url: "https://www.thrive-market.com/p/primal-kitchen-organic-unsweetened-ketchup", category: "Thrive Market / Ketchup" },

  // Eyewear
  { url: "https://www.ray-ban.com/usa/sunglasses/RB2140%20UNISEX%20original-wayfarer-classic/805289126638", category: "Ray-Ban / Sunglasses" },

  // Electronics accessories
  { url: "https://www.belkin.com/3-in-1-wireless-charger-with-official-magsafe-charging-15w/P-WIZ017.html", category: "Belkin / Charger" },

  // Musical instruments
  { url: "https://www.sweetwater.com/store/detail/StratAmProIISOB--fender-american-professional-ii-stratocaster-sienna-sunburst-with-rosewood-fingerboard", category: "Sweetwater / Guitar" },
];

const allUrls = [...existingUrls, ...newUrls];

function isValidPrice(price: string | undefined): boolean {
  if (!price) return false;
  const cleaned = price.replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return !isNaN(num) && num > 0 && num < 100_000;
}

async function queryUrl(entry: { url: string; category: string }): Promise<QueryResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(`${API_URL}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: entry.url }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const durationMs = Date.now() - start;
    const body = await resp.json() as any;

    if (!resp.ok) {
      return {
        url: entry.url,
        category: entry.category,
        success: false,
        httpStatus: resp.status,
        optionCount: 0,
        requiredFieldCount: 0,
        error: body?.error?.message ?? body?.error ?? `HTTP ${resp.status}`,
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
      httpStatus: resp.status,
      productName: product?.name,
      price: product?.price,
      route: body.route,
      discoveryMethod: body.discovery_method,
      optionCount: body.options?.length ?? 0,
      options: body.options?.map((o: any) => `${o.name}: [${o.values?.join(", ")}]`),
      requiredFieldCount: body.required_fields?.length ?? 0,
      error: !priceValid
        ? `invalid price: "${product?.price}"`
        : !nameValid
          ? `invalid name: "${product?.name}"`
          : undefined,
      durationMs,
    };
  } catch (err: any) {
    clearTimeout(timer);
    return {
      url: entry.url,
      category: entry.category,
      success: false,
      optionCount: 0,
      requiredFieldCount: 0,
      error: err?.name === "AbortError" ? `timeout (${TIMEOUT_MS / 1000}s)` : (err?.message ?? String(err)),
      durationMs: Date.now() - start,
    };
  }
}

async function main() {
  // Quick API health check
  try {
    const resp = await fetch(`${API_URL}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (resp.status === 0) throw new Error("no response");
  } catch {
    console.error(`\n  API server not reachable at ${API_URL}`);
    console.error(`  Start it: PORT=8787 npx tsx packages/api/src/index.ts\n`);
    process.exit(1);
  }

  console.log(`\n=== Query Endpoint Bulk Test ===`);
  console.log(`API:         ${API_URL}`);
  console.log(`URLs:        ${allUrls.length} (${existingUrls.length} existing + ${newUrls.length} new)`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Timeout:     ${TIMEOUT_MS / 1000}s per request\n`);

  const results: QueryResult[] = [];
  const queue = [...allUrls];

  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    const batchResults = await Promise.all(batch.map(queryUrl));

    for (const r of batchResults) {
      results.push(r);
      const idx = String(results.length).padStart(2);
      const status = r.success ? "OK" : "FAIL";
      const nameStr = r.productName ? ` "${r.productName.slice(0, 45)}"` : "";
      const priceStr = r.price ? ` $${r.price}` : "";
      const optStr = r.optionCount > 0 ? ` [${r.optionCount} opts]` : "";
      const methodStr = r.discoveryMethod ? ` (${r.discoveryMethod})` : "";
      const errStr = !r.success && r.error ? ` ERR: ${r.error.slice(0, 60)}` : "";
      const time = (r.durationMs / 1000).toFixed(1).padStart(5);
      console.log(
        `[${idx}/${allUrls.length}] ${status.padEnd(4)} ${time}s  ${r.category.padEnd(32)}${nameStr}${priceStr}${optStr}${methodStr}${errStr}`,
      );
    }
  }

  // ---- Summary ----
  const passed = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const httpErrors = failed.filter((r) => r.httpStatus && r.httpStatus >= 400);
  const timeouts = failed.filter((r) => r.error?.includes("timeout"));
  const invalidPrice = failed.filter((r) => r.error?.startsWith("invalid price"));
  const invalidName = failed.filter((r) => r.error?.startsWith("invalid name"));
  const networkErrors = failed.filter(
    (r) => !r.httpStatus && !r.error?.includes("timeout") && !r.error?.startsWith("invalid"),
  );
  const withOptions = results.filter((r) => r.optionCount > 0);

  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const totalMs = durations.reduce((a, b) => a + b, 0);
  const p = (pct: number) => durations[Math.min(durations.length - 1, Math.ceil((pct / 100) * durations.length) - 1)] ?? 0;

  const methodCounts: Record<string, number> = {};
  const routeCounts: Record<string, number> = {};
  for (const r of results) {
    const m = r.discoveryMethod ?? "unknown";
    methodCounts[m] = (methodCounts[m] ?? 0) + 1;
    const rt = r.route ?? "unknown";
    routeCounts[rt] = (routeCounts[rt] ?? 0) + 1;
  }

  // Category breakdown
  const catMap: Record<string, { total: number; passed: number }> = {};
  for (const r of results) {
    const cat = r.category.split(" / ")[0] ?? r.category;
    if (!catMap[cat]) catMap[cat] = { total: 0, passed: 0 };
    catMap[cat].total++;
    if (r.success) catMap[cat].passed++;
  }

  // Existing vs new URL breakdown
  const existingResults = results.slice(0, existingUrls.length);
  const newResults = results.slice(existingUrls.length);
  const existingPassed = existingResults.filter((r) => r.success).length;
  const newPassed = newResults.filter((r) => r.success).length;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  QUERY ENDPOINT TEST SUMMARY`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Total:         ${results.length}`);
  console.log(`Passed:        ${passed.length} (${((passed.length / results.length) * 100).toFixed(0)}%)`);
  console.log(`Failed:        ${failed.length}`);
  console.log(`  HTTP errors:   ${httpErrors.length}`);
  console.log(`  Timeouts:      ${timeouts.length}`);
  console.log(`  Bad price:     ${invalidPrice.length}`);
  console.log(`  Bad name:      ${invalidName.length}`);
  console.log(`  Network errs:  ${networkErrors.length}`);
  console.log(`W/ Options:    ${withOptions.length}`);
  console.log(``);
  console.log(`--- Existing URLs: ${existingPassed}/${existingUrls.length} (${((existingPassed / existingUrls.length) * 100).toFixed(0)}%)`);
  console.log(`--- New URLs:      ${newPassed}/${newUrls.length} (${((newPassed / newUrls.length) * 100).toFixed(0)}%)`);
  console.log(``);
  console.log(`--- Timing ---`);
  console.log(`Avg:     ${(totalMs / results.length / 1000).toFixed(1)}s`);
  console.log(`P50:     ${(p(50) / 1000).toFixed(1)}s`);
  console.log(`P95:     ${(p(95) / 1000).toFixed(1)}s`);
  console.log(`Fastest: ${(durations[0]! / 1000).toFixed(1)}s`);
  console.log(`Slowest: ${(durations[durations.length - 1]! / 1000).toFixed(1)}s`);
  console.log(`Total:   ${(totalMs / 1000).toFixed(0)}s`);
  console.log(``);
  console.log(`--- Discovery Methods ---`);
  for (const [m, c] of Object.entries(methodCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${m.padEnd(20)} ${c}`);
  }
  console.log(``);
  console.log(`--- Routes ---`);
  for (const [r, c] of Object.entries(routeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r.padEnd(20)} ${c}`);
  }

  // Category breakdown
  console.log(``);
  console.log(`--- By Store/Brand ---`);
  const sortedCats = Object.entries(catMap).sort((a, b) => b[1].total - a[1].total);
  for (const [cat, { total, passed: p }] of sortedCats) {
    const pct = total > 0 ? ((p / total) * 100).toFixed(0) : "0";
    console.log(`  ${cat.padEnd(22)} ${p}/${total} (${pct}%)`);
  }

  // Failed URLs detail
  if (failed.length > 0) {
    console.log(``);
    console.log(`--- Failed URLs ---`);
    for (const f of failed) {
      const reason = f.error?.includes("timeout")
        ? "TIMEOUT"
        : f.httpStatus && f.httpStatus >= 400
          ? `HTTP_${f.httpStatus}`
          : f.error?.startsWith("invalid price")
            ? "BAD_PRICE"
            : f.error?.startsWith("invalid name")
              ? "BAD_NAME"
              : "ERROR";
      console.log(`  [${reason.padEnd(9)}] ${(f.durationMs / 1000).toFixed(1).padStart(5)}s  ${f.category}: ${f.url}`);
      if (f.error && reason === "ERROR") {
        console.log(`             ${f.error.slice(0, 120)}`);
      }
    }
  }

  // URLs with options detail
  if (withOptions.length > 0) {
    console.log(``);
    console.log(`--- URLs with Options ---`);
    for (const r of withOptions) {
      console.log(`  ${r.category}: ${r.productName}`);
      for (const o of r.options ?? []) {
        console.log(`    ${o}`);
      }
    }
  }

  console.log(``);
}

main().catch(console.error);
