/**
 * TDD: Field mapper tests (RED phase).
 *
 * Tests rule-based field name mapping from site-specific form fields
 * to Bloon's standard field names (shipping.email, shipping.name, etc.)
 */

import { describe, it, expect } from "vitest";
import { mapFields } from "../src/field-mapper.js";
import type { FormField } from "../src/types.js";

// ---- Rule-based mapping ----

describe("mapFields — rule-based", () => {
  it("maps common shipping field names", () => {
    const fields: FormField[] = [
      { name: "email", type: "email" },
      { name: "firstName", type: "text" },
      { name: "lastName", type: "text" },
      { name: "address1", type: "text" },
      { name: "city", type: "text" },
      { name: "province", type: "text" },
      { name: "zip", type: "text" },
      { name: "phone", type: "tel" },
    ];

    const mappings = mapFields(fields);

    expect(mappings).toContainEqual({ siteField: "email", standardField: "shipping.email" });
    expect(mappings).toContainEqual({ siteField: "firstName", standardField: "shipping.firstName" });
    expect(mappings).toContainEqual({ siteField: "lastName", standardField: "shipping.lastName" });
    expect(mappings).toContainEqual({ siteField: "address1", standardField: "shipping.street" });
    expect(mappings).toContainEqual({ siteField: "city", standardField: "shipping.city" });
    expect(mappings).toContainEqual({ siteField: "zip", standardField: "shipping.zip" });
    expect(mappings).toContainEqual({ siteField: "phone", standardField: "shipping.phone" });
  });

  it("maps fields by autocomplete attribute", () => {
    const fields: FormField[] = [
      { name: "field1", type: "email", autocomplete: "email" },
      { name: "field2", type: "text", autocomplete: "given-name" },
      { name: "field3", type: "text", autocomplete: "family-name" },
      { name: "field4", type: "text", autocomplete: "address-line1" },
      { name: "field5", type: "text", autocomplete: "postal-code" },
    ];

    const mappings = mapFields(fields);

    expect(mappings).toContainEqual({ siteField: "field1", standardField: "shipping.email" });
    expect(mappings).toContainEqual({ siteField: "field2", standardField: "shipping.firstName" });
    expect(mappings).toContainEqual({ siteField: "field3", standardField: "shipping.lastName" });
    expect(mappings).toContainEqual({ siteField: "field4", standardField: "shipping.street" });
    expect(mappings).toContainEqual({ siteField: "field5", standardField: "shipping.zip" });
  });

  it("maps Shopify-style field names", () => {
    const fields: FormField[] = [
      { name: "checkout[email]", type: "email" },
      { name: "checkout[shipping_address][first_name]", type: "text" },
      { name: "checkout[shipping_address][last_name]", type: "text" },
      { name: "checkout[shipping_address][address1]", type: "text" },
      { name: "checkout[shipping_address][city]", type: "text" },
      { name: "checkout[shipping_address][province]", type: "text" },
      { name: "checkout[shipping_address][zip]", type: "text" },
      { name: "checkout[shipping_address][country]", type: "text" },
      { name: "checkout[shipping_address][phone]", type: "tel" },
    ];

    const mappings = mapFields(fields);

    expect(mappings.length).toBeGreaterThanOrEqual(8);
    expect(mappings).toContainEqual({
      siteField: "checkout[email]",
      standardField: "shipping.email",
    });
    expect(mappings).toContainEqual({
      siteField: "checkout[shipping_address][first_name]",
      standardField: "shipping.firstName",
    });
  });

  it("maps card-related fields", () => {
    const fields: FormField[] = [
      { name: "cardnumber", type: "text", autocomplete: "cc-number" },
      { name: "exp-date", type: "text", autocomplete: "cc-exp" },
      { name: "cvc", type: "text", autocomplete: "cc-csc" },
    ];

    const mappings = mapFields(fields);

    expect(mappings).toContainEqual({ siteField: "cardnumber", standardField: "card.number" });
    expect(mappings).toContainEqual({ siteField: "exp-date", standardField: "card.expiry" });
    expect(mappings).toContainEqual({ siteField: "cvc", standardField: "card.cvv" });
  });

  it("returns empty array for hidden-only or unrecognizable fields", () => {
    const fields: FormField[] = [
      { name: "csrf_token", type: "hidden", value: "abc123" },
      { name: "utm_source", type: "hidden", value: "google" },
    ];

    const mappings = mapFields(fields);
    expect(mappings.length).toBe(0);
  });

  it("handles snake_case, camelCase, and bracket notation", () => {
    const fields: FormField[] = [
      { name: "first_name", type: "text" },
      { name: "lastName", type: "text" },
      { name: "shipping[address_line1]", type: "text" },
    ];

    const mappings = mapFields(fields);
    expect(mappings.length).toBeGreaterThanOrEqual(3);
    expect(mappings).toContainEqual({ siteField: "first_name", standardField: "shipping.firstName" });
    expect(mappings).toContainEqual({ siteField: "lastName", standardField: "shipping.lastName" });
  });
});
