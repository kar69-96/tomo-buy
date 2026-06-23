/**
 * Exa-only bulk test: calls discoverViaExa directly on all URLs.
 * No Firecrawl, no scrape, no Browserbase — just Exa.
 *
 * Usage: set -a && source .env && set +a && npx tsx packages/crawling/tests/exa-only-bulk.ts
 */

import { discoverViaExa } from "../src/exa-extract.js";
import { isValidPrice } from "../src/helpers.js";

const urls: { url: string; category: string }[] = [
  // Shopify
  { url: "https://www.allbirds.com/products/mens-tree-runners", category: "Shopify / Shoes" },
  { url: "https://en.pitviper.es/products/the-actualbush-original-2-0", category: "Shopify / Sunglasses" },
  { url: "https://www.gymshark.com/products/gymshark-vital-seamless-2-0-leggings-black-ss22", category: "Shopify / Activewear" },
  { url: "https://www.brooklinen.com/products/classic-core-sheet-set", category: "Shopify / Bedding" },
  { url: "https://www.bombas.com/products/womens-gripper-ankle-sock-6-pack", category: "Shopify / Socks" },
  { url: "https://www.ruggable.com/products/solid-navy-blue-rug", category: "Shopify / Rugs" },
  { url: "https://www.chubbiesshorts.com/products/the-flint-stones", category: "Shopify / Shorts" },
  { url: "https://www.mvmt.com/products/classic-black-tan", category: "Shopify / Watches" },
  { url: "https://www.nativecos.com/products/coconut-vanilla-deodorant", category: "Shopify / Personal care" },
  { url: "https://www.hydroflask.com/32-oz-wide-mouth", category: "Shopify / Bottles" },
  // Fashion
  { url: "https://www.primark.com/es-es/p/pantalones-cortos-deportivos-de-malla-negro-991160590804", category: "Primark / Shorts" },
  { url: "https://www.zara.com/us/en/cotton-t-shirt-p00722325.html", category: "Zara / T-shirt" },
  { url: "https://www2.hm.com/en_us/productpage.0970818001.html", category: "H&M / Apparel" },
  { url: "https://www.uniqlo.com/us/en/products/E449982-000/00", category: "Uniqlo / Apparel" },
  { url: "https://www.nike.com/t/air-max-90-mens-shoes-6n3vKB/CN8490-001", category: "Nike / Shoes" },
  { url: "https://www.adidas.com/us/ultraboost-5-shoes/HQ6437.html", category: "Adidas / Shoes" },
  { url: "https://www.levi.com/US/en_US/clothing/men/jeans/511-slim-fit-mens-jeans/p/045115855", category: "Levi's / Jeans" },
  { url: "https://www.nordstrom.com/s/nike-dunk-low-retro-sneaker-men/6579130", category: "Nordstrom / Shoes" },
  { url: "https://www.gap.com/browse/product.do?pid=795187012", category: "Gap / Apparel" },
  // Electronics
  { url: "https://www.apple.com/shop/buy-iphone/iphone-16", category: "Apple / Phone" },
  { url: "https://www.samsung.com/us/smartphones/galaxy-s25-ultra/", category: "Samsung / Phone" },
  { url: "https://store.google.com/us/product/pixel_9", category: "Google / Phone" },
  { url: "https://www.bose.com/p/headphones/bose-quietcomfort-ultra-headphones/QCUH-HEADPHONEARN.html", category: "Bose / Headphones" },
  { url: "https://www.sony.com/en/headphones/wh-1000xm5", category: "Sony / Headphones" },
  { url: "https://www.logitech.com/en-us/products/mice/mx-master-3s.910-006557.html", category: "Logitech / Mouse" },
  { url: "https://www.anker.com/products/a2337-usb-c-charger-67w", category: "Anker / Charger" },
  // Home
  { url: "https://www.ikea.com/us/en/p/kallax-shelf-unit-white-00275848/", category: "IKEA / Furniture" },
  { url: "https://www.wayfair.com/furniture/pdp/mercury-row-arviso-upholstered-platform-bed-w007705244.html", category: "Wayfair / Furniture" },
  { url: "https://www.cb2.com/taper-black-marble-side-table/s547916", category: "CB2 / Furniture" },
  { url: "https://www.westelm.com/products/mid-century-bedside-table-h433/", category: "West Elm / Furniture" },
  // Grocery
  { url: "https://www.instacart.com/store/whole-foods-market/product_page/365-by-whole-foods-market-organic-whole-milk-1-gal", category: "Instacart / Grocery" },
  { url: "https://www.thrive.market/p/primal-kitchen-classic-bbq-sauce", category: "Thrive / Food" },
  // Beauty
  { url: "https://www.sephora.com/product/the-porefessional-face-primer-P264900", category: "Sephora / Makeup" },
  { url: "https://www.ulta.com/p/dream-cream-body-lotion-pimprod2003346", category: "Ulta / Skincare" },
  { url: "https://theordinary.com/en-us/hyaluronic-acid-2-b5-hydrating-serum-100098.html", category: "The Ordinary / Skincare" },
  { url: "https://www.cerave.com/skincare/moisturizers/moisturizing-cream", category: "CeraVe / Skincare" },
  { url: "https://glossier.com/products/boy-brow", category: "Glossier / Makeup" },
  // Outdoor
  { url: "https://www.rei.com/product/171554/patagonia-better-sweater-fleece-jacket-mens", category: "REI / Outdoor" },
  { url: "https://www.patagonia.com/product/mens-nano-puff-jacket/84212.html", category: "Patagonia / Jacket" },
  { url: "https://www.yeti.com/drinkware/bottles/21071501392.html", category: "Yeti / Drinkware" },
  { url: "https://www.thenorthface.com/en-us/mens/mens-jackets-and-vests/mens-fleece-c210237/m-denali-jacket-pNF0A7UR2", category: "North Face / Jacket" },
  // Books
  { url: "https://bookshop.org/p/books/atomic-habits-james-clear/7244448", category: "Bookshop / Book" },
  { url: "https://www.barnesandnoble.com/w/project-hail-mary-andy-weir/1137396811", category: "B&N / Book" },
  // Pet
  { url: "https://www.chewy.com/dp/54226", category: "Chewy / Pet food" },
  // DTC
  { url: "https://www.warbyparker.com/eyeglasses/women/durand/crystal", category: "Warby Parker / Glasses" },
  { url: "https://www.casper.com/mattresses/original/", category: "Casper / Mattress" },
  { url: "https://www.away.com/suitcases/the-carry-on", category: "Away / Luggage" },
  { url: "https://www.everlane.com/products/mens-premium-weight-crew-tee-black", category: "Everlane / Apparel" },
  { url: "https://www.aesop.com/us/p/skin/hydrate/camellia-nut-facial-hydrating-cream/", category: "Aesop / Skincare" },
  { url: "https://www.lego.com/en-us/product/eiffel-tower-10307", category: "Lego / Toys" },
  { url: "https://www.dyson.com/vacuum-cleaners/cordless/v15/detect-absolute-yellow-iron", category: "Dyson / Vacuum" },
  // International
  { url: "https://www.asos.com/us/asos-design/asos-design-oversized-t-shirt-in-black/prd/203426899", category: "ASOS / Apparel" },
  { url: "https://www.decathlon.com/products/mens-mountain-hiking-waterproof-jacket-mh500", category: "Decathlon / Outdoor" },
  { url: "https://www.muji.com/us/products/cmdty/detail/4550344592045", category: "Muji / Home" },
  // Health
  { url: "https://www.iherb.com/pr/nature-s-way-alive-once-daily-multi-vitamin-ultra-potency-60-tablets/14811", category: "iHerb / Vitamins" },
  { url: "https://athleticgreens.com/en", category: "AG1 / Supplements" },
  // Marketplace
  { url: "https://www.etsy.com/listing/1020399732/custom-name-necklace-personalized", category: "Etsy / Jewelry" },
  { url: "https://www.ebay.com/itm/394944449784", category: "eBay / Marketplace" },
  { url: "https://www.target.com/p/apple-airpods-pro-2nd-generation/-/A-85978612", category: "Target / Electronics" },
  { url: "https://www.walmart.com/ip/Crayola-96ct-Crayons/17801992", category: "Walmart / Toys" },
  { url: "https://www.costco.com/kirkland-signature-organic-extra-virgin-olive-oil%2C-2-l.product.100334841.html", category: "Costco / Grocery" },
];

const CONCURRENCY = parseInt(process.env.EXA_TEST_CONCURRENCY ?? "5", 10);

interface Result {
  url: string;
  category: string;
  success: boolean;
  name?: string;
  price?: string;
  brand?: string;
  optionCount: number;
  options?: string[];
  priceValid: boolean;
  error?: string;
  durationMs: number;
}

async function testOne(entry: { url: string; category: string }): Promise<Result> {
  const start = Date.now();
  try {
    const r = await discoverViaExa(entry.url);
    const ms = Date.now() - start;
    if (!r) {
      return { url: entry.url, category: entry.category, success: false, priceValid: false, optionCount: 0, error: "null (no data)", durationMs: ms };
    }
    const pv = isValidPrice(r.price);
    const nv = Boolean(r.name && r.name.trim().length >= 3);
    return {
      url: entry.url,
      category: entry.category,
      success: pv && nv,
      name: r.name,
      price: r.price,
      brand: r.brand,
      optionCount: r.options.length,
      options: r.options.map(o => `${o.name}: [${o.values.join(", ")}]${o.prices ? ` prices: ${JSON.stringify(o.prices)}` : ""}`),
      priceValid: pv,
      error: !pv ? `bad price: "${r.price}"` : !nv ? "bad name" : undefined,
      durationMs: ms,
    };
  } catch (err: any) {
    return { url: entry.url, category: entry.category, success: false, priceValid: false, optionCount: 0, error: err?.message?.slice(0, 100) ?? String(err).slice(0, 100), durationMs: Date.now() - start };
  }
}

async function main() {
  console.log(`\n=== Exa-Only Bulk Test ===`);
  console.log(`URLs: ${urls.length} | Concurrency: ${CONCURRENCY}\n`);

  const results: Result[] = [];
  const queue = [...urls];

  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    const batchResults = await Promise.all(batch.map(testOne));
    for (const r of batchResults) {
      results.push(r);
      const status = r.success ? "OK" : "FAIL";
      const nameStr = r.name ? ` "${r.name.slice(0, 40)}"` : "";
      const priceStr = r.price ? ` $${r.price}` : "";
      const optStr = r.optionCount > 0 ? ` (${r.optionCount} opts)` : "";
      const errStr = !r.success ? ` | ${r.error?.slice(0, 60) ?? ""}` : "";
      console.log(
        `[${String(results.length).padStart(2)}/${urls.length}] ${status.padEnd(4)} ${(r.durationMs / 1000).toFixed(1).padStart(5)}s  ${r.category.padEnd(26)}${nameStr}${priceStr}${optStr}${errStr}`,
      );
    }
  }

  const passed = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const withOptions = passed.filter(r => r.optionCount > 0);
  const totalMs = results.reduce((a, r) => a + r.durationMs, 0);

  console.log(`\n${"=".repeat(70)}`);
  console.log(`EXA-ONLY RESULTS`);
  console.log(`${"=".repeat(70)}`);
  console.log(`Total:       ${results.length}`);
  console.log(`Passed:      ${passed.length} (${((passed.length / results.length) * 100).toFixed(0)}%)`);
  console.log(`Failed:      ${failed.length}`);
  console.log(`With opts:   ${withOptions.length}`);
  console.log(`Total time:  ${(totalMs / 1000).toFixed(0)}s`);

  if (passed.length > 0) {
    console.log(`\n--- Passed (${passed.length}) ---`);
    for (const r of passed) {
      console.log(`  ${r.category.padEnd(26)} "${r.name?.slice(0, 45)}" $${r.price} ${r.brand ? `[${r.brand}]` : ""}`);
      if (r.options && r.options.length > 0) {
        for (const o of r.options) console.log(`    ${o}`);
      }
    }
  }

  if (failed.length > 0) {
    console.log(`\n--- Failed (${failed.length}) ---`);
    for (const f of failed) {
      console.log(`  ${f.category.padEnd(26)} ${f.error?.slice(0, 80)}`);
    }
  }
}

main().catch(console.error);
