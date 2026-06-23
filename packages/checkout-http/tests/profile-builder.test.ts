/**
 * TDD: Profile builder tests (RED phase).
 *
 * Tests conversion of a WalkerTrace (recorded request/response)
 * into a SiteProfile (cached, replayable).
 */

import { describe, it, expect } from "vitest";
import { buildProfile } from "../src/profile-builder.js";
import type { WalkerTrace, TraceStep } from "../src/profile-builder.js";

// ---- Fixture helpers ----

function makeTraceStep(overrides: Partial<TraceStep> = {}): TraceStep {
  return {
    url: "https://example.com/checkout",
    method: "GET",
    requestHeaders: {},
    responseStatus: 200,
    responseHeaders: { "content-type": "text/html" },
    responseBody: "<html><body>Checkout</body></html>",
    responseContentType: "text/html",
    setCookies: [],
    redirectChain: [],
    pageType: "shipping-form",
    extractedValues: {},
    ...overrides,
  };
}

function makeTrace(overrides: Partial<WalkerTrace> = {}): WalkerTrace {
  return {
    domain: "example.com",
    platform: "shopify",
    botProtection: "none",
    steps: [
      makeTraceStep({
        url: "https://example.com/cart",
        method: "POST",
        requestBody: JSON.stringify({ id: "variant_123", quantity: 1 }),
        requestContentType: "application/json",
        responseStatus: 200,
        responseBody: JSON.stringify({ token: "cart_abc123" }),
        responseContentType: "application/json",
        pageType: "cart",
        extractedValues: { cart_token: "cart_abc123" },
      }),
      makeTraceStep({
        url: "https://example.com/checkout",
        method: "GET",
        responseStatus: 200,
        responseBody: '<html><body><form><input name="email" type="email"/><input name="csrf" type="hidden" value="tok123"/></form></body></html>',
        pageType: "shipping-form",
        extractedValues: { csrf_token: "tok123" },
      }),
      makeTraceStep({
        url: "https://example.com/checkout/shipping",
        method: "POST",
        requestBody: "email=test@test.com&name=Test",
        requestContentType: "application/x-www-form-urlencoded",
        responseStatus: 200,
        responseBody: JSON.stringify({ shipping_rate: "standard" }),
        responseContentType: "application/json",
        pageType: "shipping-form",
        extractedValues: { shipping_rate_id: "standard" },
      }),
    ],
    ...overrides,
  };
}

// ---- Profile building ----

describe("buildProfile", () => {
  it("builds a SiteProfile from a 3-step trace", () => {
    const trace = makeTrace();
    const profile = buildProfile(trace);

    expect(profile.domain).toBe("example.com");
    expect(profile.platform).toBe("shopify");
    expect(profile.botProtection).toBe("none");
    expect(profile.endpoints.length).toBe(3);
    expect(profile.httpEligible).toBe(true);
    expect(profile.version).toBe(1);
  });

  it("preserves HTTP methods per step", () => {
    const trace = makeTrace();
    const profile = buildProfile(trace);

    expect(profile.endpoints[0]!.method).toBe("POST");
    expect(profile.endpoints[1]!.method).toBe("GET");
    expect(profile.endpoints[2]!.method).toBe("POST");
  });

  it("captures extracted values as DynamicValue extractions", () => {
    const trace = makeTrace();
    const profile = buildProfile(trace);

    // Step 0 extracted cart_token from JSON response
    const step0 = profile.endpoints[0]!;
    expect(step0.extractions).toBeDefined();
    expect(step0.extractions!.length).toBeGreaterThan(0);
    expect(step0.extractions!.some((e) => e.name === "cart_token")).toBe(true);
  });

  it("sets content type on POST steps", () => {
    const trace = makeTrace();
    const profile = buildProfile(trace);

    expect(profile.endpoints[0]!.contentType).toBe("application/json");
    expect(profile.endpoints[2]!.contentType).toMatch(/urlencoded|json/);
  });

  it("generates response fingerprints for each step", () => {
    const trace = makeTrace();
    const profile = buildProfile(trace);

    for (const step of profile.endpoints) {
      expect(step.fingerprint).toBeDefined();
      expect(step.fingerprint!.statusCode).toBeDefined();
    }
  });

  it("includes Stripe integration when pk_ key present", () => {
    const trace = makeTrace({ stripePublishableKey: "pk_test_abc123" });
    const profile = buildProfile(trace);

    expect(profile.stripe).toBeDefined();
    expect(profile.stripe!.publishableKey).toBe("pk_test_abc123");
  });

  it("sets staleness metadata with default TTL", () => {
    const profile = buildProfile(makeTrace());

    expect(profile.staleness).toBeDefined();
    expect(profile.staleness.baseTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(profile.staleness.currentTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(profile.staleness.invalidationCount).toBe(0);
  });

  it("sets createdAt and updatedAt as ISO timestamps", () => {
    const profile = buildProfile(makeTrace());

    expect(profile.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(profile.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("builds page classifications from step page types", () => {
    const trace = makeTrace();
    const profile = buildProfile(trace);

    expect(Object.keys(profile.pageClassifications).length).toBeGreaterThan(0);
  });
});
