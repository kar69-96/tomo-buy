/**
 * TDD: Platform detection tests (RED phase).
 *
 * Tests Shopify, WooCommerce, BigCommerce, Magento, and unknown
 * detection from HTTP response headers, cookies, HTML, and script sources.
 */

import { describe, it, expect } from "vitest";
import { detectPlatform } from "../src/platform-detector.js";
import { parseHTML } from "../src/page-parser.js";
import type { FetchResult } from "../src/types.js";

// ---- Fixture helpers ----

function makeFetchResult(overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    url: "https://example.com/product",
    finalUrl: "https://example.com/product",
    statusCode: 200,
    headers: {},
    body: "<html><body><h1>Product</h1></body></html>",
    contentType: "text/html",
    redirectChain: [],
    setCookies: [],
    ...overrides,
  };
}

// ---- Shopify detection ----

describe("detectPlatform — Shopify", () => {
  it("detects Shopify from X-ShopId header", () => {
    const fetch = makeFetchResult({
      headers: { "x-shopid": "12345", "x-shardid": "1" },
    });
    const snapshot = parseHTML(fetch.body, fetch.url);
    expect(detectPlatform(fetch, snapshot)).toBe("shopify");
  });

  it("detects Shopify from cdn.shopify.com script", () => {
    const html = `<html><body>
      <script src="https://cdn.shopify.com/s/files/1/shop.js"></script>
      <h1>Product</h1>
    </body></html>`;
    const fetch = makeFetchResult({ body: html });
    const snapshot = parseHTML(html, fetch.url);
    expect(detectPlatform(fetch, snapshot)).toBe("shopify");
  });

  it("detects Shopify from Shopify.shop inline config", () => {
    const html = `<html><body>
      <script>window.Shopify = { shop: "test-store.myshopify.com" };</script>
      <h1>Product</h1>
    </body></html>`;
    const fetch = makeFetchResult({ body: html });
    const snapshot = parseHTML(html, fetch.url);
    expect(detectPlatform(fetch, snapshot)).toBe("shopify");
  });

  it("detects Shopify from _shopify_y cookie", () => {
    const fetch = makeFetchResult({
      setCookies: ["_shopify_y=abc123; path=/; HttpOnly"],
    });
    const snapshot = parseHTML(fetch.body, fetch.url);
    expect(detectPlatform(fetch, snapshot)).toBe("shopify");
  });
});

// ---- WooCommerce detection ----

describe("detectPlatform — WooCommerce", () => {
  it("detects WooCommerce from wc-ajax in body", () => {
    const html = `<html><body>
      <script>var wc_add_to_cart_params = {"ajax_url":"/?wc-ajax=add_to_cart"};</script>
      <h1>Product</h1>
    </body></html>`;
    const fetch = makeFetchResult({ body: html });
    const snapshot = parseHTML(html, fetch.url);
    expect(detectPlatform(fetch, snapshot)).toBe("woocommerce");
  });

  it("detects WooCommerce from wp-content/plugins/woocommerce", () => {
    const html = `<html><body>
      <link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/style.css">
      <h1>Product</h1>
    </body></html>`;
    const fetch = makeFetchResult({ body: html });
    const snapshot = parseHTML(html, fetch.url);
    expect(detectPlatform(fetch, snapshot)).toBe("woocommerce");
  });

  it("detects WooCommerce from woocommerce-session cookie", () => {
    const fetch = makeFetchResult({
      setCookies: ["wp_woocommerce_session_abc=xyz; path=/"],
    });
    const snapshot = parseHTML(fetch.body, fetch.url);
    expect(detectPlatform(fetch, snapshot)).toBe("woocommerce");
  });
});

// ---- BigCommerce detection ----

describe("detectPlatform — BigCommerce", () => {
  it("detects BigCommerce from X-BC-Store-Version header", () => {
    const fetch = makeFetchResult({
      headers: { "x-bc-store-version": "2.1.0" },
    });
    const snapshot = parseHTML(fetch.body, fetch.url);
    expect(detectPlatform(fetch, snapshot)).toBe("bigcommerce");
  });

  it("detects BigCommerce from bigcommerce.com CDN script", () => {
    const html = `<html><body>
      <script src="https://cdn11.bigcommerce.com/s-abc/stencil/bundle.js"></script>
      <h1>Product</h1>
    </body></html>`;
    const fetch = makeFetchResult({ body: html });
    const snapshot = parseHTML(html, fetch.url);
    expect(detectPlatform(fetch, snapshot)).toBe("bigcommerce");
  });
});

// ---- Magento detection ----

describe("detectPlatform — Magento", () => {
  it("detects Magento from mage-cache-storage cookie", () => {
    const fetch = makeFetchResult({
      setCookies: ["mage-cache-storage={}; path=/"],
    });
    const snapshot = parseHTML(fetch.body, fetch.url);
    expect(detectPlatform(fetch, snapshot)).toBe("magento");
  });

  it("detects Magento from requirejs-config in body", () => {
    const html = `<html><body>
      <script>require.config({"baseUrl":"/static/frontend/Magento"});</script>
      <h1>Product</h1>
    </body></html>`;
    const fetch = makeFetchResult({ body: html });
    const snapshot = parseHTML(html, fetch.url);
    expect(detectPlatform(fetch, snapshot)).toBe("magento");
  });
});

// ---- Unknown/Custom detection ----

describe("detectPlatform — Unknown/Custom", () => {
  it("returns 'unknown' for generic HTML with no platform signals", () => {
    const html = `<html><body><h1>Product</h1><p>Price: $29.99</p></body></html>`;
    const fetch = makeFetchResult({ body: html });
    const snapshot = parseHTML(html, fetch.url);
    expect(detectPlatform(fetch, snapshot)).toBe("unknown");
  });

  it("returns 'custom' for pages with checkout forms but no platform", () => {
    const html = `<html><body>
      <h1>Checkout</h1>
      <form action="/checkout/process" method="POST">
        <input name="email" type="email" />
        <input name="address" type="text" />
        <button type="submit">Place Order</button>
      </form>
    </body></html>`;
    const fetch = makeFetchResult({ body: html, url: "https://custom-store.com/checkout" });
    const snapshot = parseHTML(html, fetch.url);
    const result = detectPlatform(fetch, snapshot);
    // Should be either "custom" or "unknown" — not misidentified as a known platform
    expect(["custom", "unknown"]).toContain(result);
  });
});
