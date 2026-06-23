import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isCdpField,
  sanitizeShipping,
  buildCredentials,
  getStagehandVariables,
  getCdpCredentials,
} from "../src/credentials.js";
import type { ShippingInfo } from "@bloon/core";

// Set up card/billing env vars for tests
const CARD_ENV = {
  CARD_NUMBER: "4111111111111111",
  CARD_EXPIRY: "12/25",
  CARD_CVV: "123",
  CARDHOLDER_NAME: "John Doe",
  BILLING_STREET: "123 Main St",
  BILLING_CITY: "Austin",
  BILLING_STATE: "TX",
  BILLING_ZIP: "78701",
  BILLING_COUNTRY: "US",
};

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [key, value] of Object.entries(CARD_ENV)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
});

afterEach(() => {
  for (const key of Object.keys(CARD_ENV)) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

const testShipping: ShippingInfo = {
  name: "Jane Smith",
  street: "456 Oak Ave",
  city: "Portland",
  state: "OR",
  zip: "97201",
  country: "US",
  email: "jane@example.com",
  phone: "503-555-0100",
};

describe("isCdpField", () => {
  it("returns true for card fields", () => {
    expect(isCdpField("x_card_number")).toBe(true);
    expect(isCdpField("x_card_expiry")).toBe(true);
    expect(isCdpField("x_card_cvv")).toBe(true);
    expect(isCdpField("x_cardholder_name")).toBe(true);
  });

  it("returns false for non-card fields", () => {
    expect(isCdpField("x_shipping_name")).toBe(false);
    expect(isCdpField("x_billing_street")).toBe(false);
  });
});

describe("sanitizeShipping", () => {
  it("strips unsafe characters", () => {
    const dirty: ShippingInfo = {
      name: 'John <script>alert("xss")</script>',
      street: "123 Main St & Apt 'B'",
      city: "Austin",
      state: "TX",
      zip: "78701",
      country: "US",
      email: "john@example.com",
      phone: "512-555-0100",
    };
    const clean = sanitizeShipping(dirty);
    expect(clean.name).toBe("John scriptalert(xss)/script");
    expect(clean.street).toBe("123 Main St  Apt B");
  });

  it("truncates fields longer than 200 characters", () => {
    const long: ShippingInfo = {
      name: "A".repeat(300),
      street: "B".repeat(300),
      city: "C".repeat(300),
      state: "TX",
      zip: "78701",
      country: "US",
      email: "test@example.com",
      phone: "512-555-0100",
    };
    const clean = sanitizeShipping(long);
    expect(clean.name).toHaveLength(200);
    expect(clean.street).toHaveLength(200);
    expect(clean.city).toHaveLength(200);
  });
});

describe("buildCredentials", () => {
  it("builds a map with all 18 keys", () => {
    const creds = buildCredentials(testShipping);
    expect(Object.keys(creds)).toHaveLength(18);
  });

  it("maps card values from env", () => {
    const creds = buildCredentials(testShipping);
    expect(creds.x_card_number).toBe("4111111111111111");
    expect(creds.x_card_expiry).toBe("12/25");
    expect(creds.x_card_cvv).toBe("123");
    expect(creds.x_cardholder_name).toBe("John Doe");
  });

  it("maps billing values from env", () => {
    const creds = buildCredentials(testShipping);
    expect(creds.x_billing_street).toBe("123 Main St");
    expect(creds.x_billing_city).toBe("Austin");
  });

  it("maps sanitized shipping values", () => {
    const creds = buildCredentials(testShipping);
    expect(creds.x_shipping_name).toBe("Jane Smith");
    expect(creds.x_shipping_email).toBe("jane@example.com");
  });
});

describe("getStagehandVariables", () => {
  it("returns 14 non-card fields", () => {
    const creds = buildCredentials(testShipping);
    const vars = getStagehandVariables(creds);
    expect(Object.keys(vars)).toHaveLength(14);
  });

  it("excludes all card fields", () => {
    const creds = buildCredentials(testShipping);
    const vars = getStagehandVariables(creds);
    expect(vars).not.toHaveProperty("x_card_number");
    expect(vars).not.toHaveProperty("x_card_expiry");
    expect(vars).not.toHaveProperty("x_card_cvv");
    expect(vars).not.toHaveProperty("x_cardholder_name");
  });
});

describe("getCdpCredentials", () => {
  it("returns exactly 4 card fields", () => {
    const creds = buildCredentials(testShipping);
    const cdp = getCdpCredentials(creds);
    expect(Object.keys(cdp)).toHaveLength(4);
    expect(cdp).toHaveProperty("x_card_number");
    expect(cdp).toHaveProperty("x_card_expiry");
    expect(cdp).toHaveProperty("x_card_cvv");
    expect(cdp).toHaveProperty("x_cardholder_name");
  });

  it("excludes non-card fields", () => {
    const creds = buildCredentials(testShipping);
    const cdp = getCdpCredentials(creds);
    expect(cdp).not.toHaveProperty("x_shipping_name");
    expect(cdp).not.toHaveProperty("x_billing_street");
  });
});
