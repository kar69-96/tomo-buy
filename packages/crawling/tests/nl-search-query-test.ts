/**
 * NL Search Query endpoint (POST /api/query) integration test.
 *
 * Sends diverse natural language queries and validates every returned product:
 *   - name exists and length >= 3
 *   - price parses to a valid number > 0
 *   - URL is valid and HEAD-reachable (non-404/410)
 *   - route and discovery_method are present
 *   - required_fields array is non-empty
 *
 * Any invalid product in the response is a pipeline bug — the pipeline should
 * never return bad data.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   API_URL=http://localhost:8787 npx tsx packages/crawling/tests/nl-search-query-test.ts
 */

const API_URL = process.env.API_URL ?? "http://localhost:8787";
const CONCURRENCY = parseInt(process.env.NL_TEST_CONCURRENCY ?? "2", 10);
const TIMEOUT_MS = 120_000; // 2 min per query
const URL_CHECK_TIMEOUT_MS = 10_000; // 10s per URL reachability check

// ---- Test queries (diverse product categories) ----

const TEST_QUERIES: string[] = [
  "wireless bluetooth headphones",
  "running shoes for men",
  "organic coffee beans",
  "mechanical keyboard",
  "yoga mat",
  "kids winter jacket",
  "protein powder chocolate",
  "moisturizer for dry skin",
  "cast iron skillet",
  "portable phone charger",
  "hiking backpack",
  "dog food grain free",
  "lego set for adults",
  "desk lamp LED",
  "noise cancelling earbuds",
  "men's dress shirt",
  "stainless steel water bottle",
  "board game for family",
  "electric toothbrush",
  "laptop stand for desk",
  "face sunscreen SPF 50",
  "wireless mouse",
  "air fryer",
  "travel luggage carry on",
];

// ---- Types ----

interface ProductValidation {
  name: string | undefined;
  price: string | undefined;
  url: string | undefined;
  nameValid: boolean;
  priceValid: boolean;
  urlValid: boolean;
  urlReachable: boolean | null; // null = not checked (e.g. invalid URL)
  routePresent: boolean;
  discoveryMethodPresent: boolean;
  requiredFieldsPresent: boolean;
  allValid: boolean;
  errors: string[];
}

interface QueryTestResult {
  query: string;
  success: boolean;
  httpStatus?: number;
  productCount: number;
  validProducts: number;
  invalidProducts: number;
  products: ProductValidation[];
  durationMs: number;
  error?: string;
}

// ---- Validation helpers ----

function isValidPrice(price: string | undefined): boolean {
  if (!price) return false;
  const cleaned = price.replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return !isNaN(num) && num > 0 && num < 100_000;
}

function isValidUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

const ADAPTER_URL =
  process.env.BROWSERBASE_ADAPTER_URL ?? "http://localhost:3003";

const ADAPTER_SCRAPE_TIMEOUT_MS = 45_000;

/**
 * Check URL reachability via Browserbase adapter (stealth + proxy).
 * Fallback for 403 bot-blocked sites.
 */
async function isReachableViaBrowser(url: string): Promise<boolean> {
  try {
    const healthResp = await fetch(`${ADAPTER_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!healthResp.ok) return false; // Adapter down — can't verify
  } catch {
    return false;
  }

  try {
    const resp = await fetch(`${ADAPTER_URL}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, timeout: 30000 }),
      signal: AbortSignal.timeout(ADAPTER_SCRAPE_TIMEOUT_MS),
    });

    if (!resp.ok) return false;

    const data = (await resp.json()) as {
      pageStatusCode?: number;
      content?: string;
    };

    if (data.pageStatusCode === 404 || data.pageStatusCode === 410) return false;
    return (data.pageStatusCode === 200 && (data.content?.length ?? 0) > 500);
  } catch {
    return false;
  }
}

async function isUrlReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), URL_CHECK_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(timer);

    if (resp.status === 404 || resp.status === 410) return false;

    // 403 = bot-blocked — try Browserbase stealth fallback
    if (resp.status === 403) return isReachableViaBrowser(url);

    return true;
  } catch (err: unknown) {
    clearTimeout(timer);
    const causeCode = (err as any)?.cause?.code as string | undefined;

    // Headers overflow = aggressive bot protection (e.g. Logitech, Corsair)
    // Node's fetch wraps this as "fetch failed" with cause.code = UND_ERR_HEADERS_OVERFLOW
    if (causeCode === "UND_ERR_HEADERS_OVERFLOW") {
      return isReachableViaBrowser(url);
    }

    // Network error / timeout — try GET as fallback (some servers reject HEAD)
    const controller2 = new AbortController();
    const timer2 = setTimeout(() => controller2.abort(), URL_CHECK_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: "GET",
        signal: controller2.signal,
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      clearTimeout(timer2);

      if (resp.status === 404 || resp.status === 410) return false;
      if (resp.status === 403) return isReachableViaBrowser(url);
      return true;
    } catch (getErr: unknown) {
      clearTimeout(timer2);
      const getCauseCode = (getErr as any)?.cause?.code as string | undefined;
      // Headers overflow on GET too — try Browserbase
      if (getCauseCode === "UND_ERR_HEADERS_OVERFLOW") {
        return isReachableViaBrowser(url);
      }
      return false;
    }
  }
}

async function validateProduct(product: any): Promise<ProductValidation> {
  const name = product?.product?.name;
  const price = product?.product?.price;
  const url = product?.product?.url;
  const route = product?.route;
  const discoveryMethod = product?.discovery_method;
  const requiredFields = product?.required_fields;

  const nameValid = typeof name === "string" && name.trim().length >= 3;
  const priceValid = isValidPrice(price);
  const urlValid = isValidUrl(url);
  const routePresent = typeof route === "string" && route.length > 0;
  const discoveryMethodPresent =
    typeof discoveryMethod === "string" && discoveryMethod.length > 0;
  const requiredFieldsPresent =
    Array.isArray(requiredFields) && requiredFields.length > 0;

  let urlReachable: boolean | null = null;
  if (urlValid) {
    urlReachable = await isUrlReachable(url);
  }

  const errors: string[] = [];
  if (!nameValid)
    errors.push(`bad name: "${name}" (${typeof name === "string" ? name.length : "missing"})`);
  if (!priceValid) errors.push(`bad price: "${price}"`);
  if (!urlValid) errors.push(`invalid URL: "${url}"`);
  if (urlValid && urlReachable === false) errors.push(`unreachable URL: ${url}`);
  if (!routePresent) errors.push(`missing route`);
  if (!discoveryMethodPresent) errors.push(`missing discovery_method`);
  if (!requiredFieldsPresent) errors.push(`missing/empty required_fields`);

  const allValid =
    nameValid &&
    priceValid &&
    urlValid &&
    urlReachable !== false &&
    routePresent &&
    discoveryMethodPresent &&
    requiredFieldsPresent;

  return {
    name,
    price,
    url,
    nameValid,
    priceValid,
    urlValid,
    urlReachable,
    routePresent,
    discoveryMethodPresent,
    requiredFieldsPresent,
    allValid,
    errors,
  };
}

// ---- Query runner ----

async function runQuery(query: string): Promise<QueryTestResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(`${API_URL}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const durationMs = Date.now() - start;
    const body = (await resp.json()) as any;

    if (!resp.ok) {
      return {
        query,
        success: false,
        httpStatus: resp.status,
        productCount: 0,
        validProducts: 0,
        invalidProducts: 0,
        products: [],
        durationMs,
        error: body?.error?.message ?? body?.error ?? `HTTP ${resp.status}`,
      };
    }

    // Validate response shape
    if (body.type !== "search" || !Array.isArray(body.products)) {
      return {
        query,
        success: false,
        httpStatus: resp.status,
        productCount: 0,
        validProducts: 0,
        invalidProducts: 0,
        products: [],
        durationMs,
        error: `unexpected response type: "${body.type}", expected "search"`,
      };
    }

    // Validate each product sequentially to avoid overwhelming the adapter
    // with concurrent Browserbase sessions for bot-blocked URLs
    const productValidations: ProductValidation[] = [];
    for (const p of body.products) {
      productValidations.push(await validateProduct(p));
    }

    const validCount = productValidations.filter((v) => v.allValid).length;
    const invalidCount = productValidations.filter((v) => !v.allValid).length;

    return {
      query,
      success: invalidCount === 0 && productValidations.length > 0,
      httpStatus: resp.status,
      productCount: productValidations.length,
      validProducts: validCount,
      invalidProducts: invalidCount,
      products: productValidations,
      durationMs,
    };
  } catch (err: any) {
    clearTimeout(timer);
    return {
      query,
      success: false,
      productCount: 0,
      validProducts: 0,
      invalidProducts: 0,
      products: [],
      durationMs: Date.now() - start,
      error:
        err?.name === "AbortError"
          ? `timeout (${TIMEOUT_MS / 1000}s)`
          : (err?.message ?? String(err)),
    };
  }
}

// ---- Main ----

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
    console.error(
      `  Start it: PORT=8787 npx tsx packages/api/src/index.ts\n`,
    );
    process.exit(1);
  }

  console.log(`\n=== NL Search Query Endpoint Test ===`);
  console.log(`API:         ${API_URL}`);
  console.log(`Queries:     ${TEST_QUERIES.length}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Timeout:     ${TIMEOUT_MS / 1000}s per query\n`);

  const results: QueryTestResult[] = [];
  const queue = [...TEST_QUERIES];

  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    const batchResults = await Promise.all(batch.map(runQuery));

    for (const r of batchResults) {
      results.push(r);
      const idx = String(results.length).padStart(2);
      const status = r.success ? "OK" : "FAIL";
      const time = (r.durationMs / 1000).toFixed(1).padStart(5);
      const prodStr = `${r.validProducts}/${r.productCount} valid`;

      console.log(
        `[${idx}/${TEST_QUERIES.length}] ${status.padEnd(4)} ${time}s  "${r.query}"  ${prodStr}`,
      );

      // Print invalid product details inline
      if (r.invalidProducts > 0) {
        for (const p of r.products.filter((v) => !v.allValid)) {
          const nameSnip = p.name
            ? `"${p.name.slice(0, 40)}"`
            : "(no name)";
          console.log(
            `       INVALID: ${nameSnip}  ${p.errors.join("; ")}`,
          );
        }
      }

      if (r.error) {
        console.log(`       ERROR: ${r.error.slice(0, 100)}`);
      }
    }
  }

  // ---- Summary ----
  const allValid = results.filter((r) => r.success);
  const withFailures = results.filter(
    (r) => !r.success && r.invalidProducts > 0,
  );
  const noResults = results.filter(
    (r) => r.productCount === 0 && !r.error,
  );
  const errors = results.filter((r) => !!r.error);

  const totalProducts = results.reduce((s, r) => s + r.productCount, 0);
  const totalValid = results.reduce((s, r) => s + r.validProducts, 0);
  const totalInvalid = results.reduce((s, r) => s + r.invalidProducts, 0);

  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const totalMs = durations.reduce((a, b) => a + b, 0);
  const pct = (p: number) =>
    durations[
      Math.min(
        durations.length - 1,
        Math.ceil((p / 100) * durations.length) - 1,
      )
    ] ?? 0;

  // Error breakdown across all products
  const errorCounts: Record<string, number> = {};
  for (const r of results) {
    for (const p of r.products.filter((v) => !v.allValid)) {
      for (const e of p.errors) {
        const key = e.split(":")[0]!.trim();
        errorCounts[key] = (errorCounts[key] ?? 0) + 1;
      }
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  NL SEARCH QUERY TEST SUMMARY`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Queries:              ${results.length}`);
  console.log(
    `All-valid queries:    ${allValid.length} (${((allValid.length / results.length) * 100).toFixed(0)}%)`,
  );
  console.log(`Queries w/ bad prods: ${withFailures.length}`);
  console.log(`Queries w/ no results:${noResults.length}`);
  console.log(`Queries w/ errors:    ${errors.length}`);
  console.log(``);
  console.log(`--- Product Validation ---`);
  console.log(`Total products:       ${totalProducts}`);
  console.log(
    `Valid products:       ${totalValid} (${totalProducts > 0 ? ((totalValid / totalProducts) * 100).toFixed(0) : 0}%)`,
  );
  console.log(`Invalid products:     ${totalInvalid}`);
  if (totalProducts > 0) {
    console.log(
      `Avg products/query:   ${(totalProducts / results.length).toFixed(1)}`,
    );
  }
  console.log(``);
  console.log(`--- Timing ---`);
  console.log(`Avg:     ${(totalMs / results.length / 1000).toFixed(1)}s`);
  console.log(`P50:     ${(pct(50) / 1000).toFixed(1)}s`);
  console.log(`P95:     ${(pct(95) / 1000).toFixed(1)}s`);
  console.log(
    `Fastest: ${(durations[0]! / 1000).toFixed(1)}s`,
  );
  console.log(
    `Slowest: ${(durations[durations.length - 1]! / 1000).toFixed(1)}s`,
  );
  console.log(`Total:   ${(totalMs / 1000).toFixed(0)}s`);

  // Error type breakdown
  if (Object.keys(errorCounts).length > 0) {
    console.log(``);
    console.log(`--- Invalid Product Error Types ---`);
    for (const [errType, count] of Object.entries(errorCounts).sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  ${errType.padEnd(30)} ${count}`);
    }
  }

  // Failing queries detail
  if (withFailures.length > 0 || errors.length > 0) {
    console.log(``);
    console.log(`--- Failing Queries ---`);
    for (const r of results.filter((r) => !r.success)) {
      const reason = r.error
        ? r.error.includes("timeout")
          ? "TIMEOUT"
          : "ERROR"
        : r.productCount === 0
          ? "NO_RESULTS"
          : "BAD_PRODUCTS";
      console.log(
        `  [${reason.padEnd(12)}] ${(r.durationMs / 1000).toFixed(1).padStart(5)}s  "${r.query}"`,
      );
      if (r.error) {
        console.log(`               ${r.error.slice(0, 120)}`);
      }
      for (const p of r.products.filter((v) => !v.allValid)) {
        console.log(
          `               ${p.name ? `"${p.name.slice(0, 40)}"` : "(no name)"}: ${p.errors.join("; ")}`,
        );
      }
    }
  }

  // All-valid queries detail
  if (allValid.length > 0) {
    console.log(``);
    console.log(`--- Passing Queries ---`);
    for (const r of allValid) {
      console.log(
        `  ${(r.durationMs / 1000).toFixed(1).padStart(5)}s  "${r.query}"  (${r.productCount} products)`,
      );
    }
  }

  console.log(``);

  // Exit code: fail if any invalid products were returned
  if (totalInvalid > 0 || errors.length > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
