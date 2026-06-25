import { describe, it, expect, vi } from "vitest";
import { buildToolset } from "../src/cua/tools.js";
import type { CuaTool, ToolContext, ShippingData } from "../src/cua/tools.js";

const shipping: ShippingData = {
  email: "a@b.com", firstName: "A", lastName: "B", street: "1 St", apartment: "",
  city: "C", state: "S", zip: "00000", country: "US", phone: "5550000000",
};

/** A page proxy that fails the test if any Playwright method is touched. */
function untouchablePage(): any {
  return new Proxy(
    {},
    { get(_t, prop) { throw new Error(`page.${String(prop)} must not be called`); } },
  );
}

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    page: untouchablePage(),
    context: {} as any,
    variables: { x_shipping_email: "a@b.com", x_login_password: "SECRET" },
    cdpCreds: { x_card_number: "4111111111111111" },
    shippingData: shipping,
    domain: "example.com",
    log: () => {},
    ...overrides,
  };
}

function tool(name: string): CuaTool {
  const t = buildToolset({ dryRun: false }).find((x) => x.def.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

describe("buildToolset()", () => {
  it("offers the full stable tool interface", () => {
    const names = buildToolset({ dryRun: false }).map((t) => t.def.name).sort();
    expect(names).toEqual(
      [
        "click", "dismiss_popups", "fill_card", "fill_otp", "fill_shipping",
        "finish", "login", "press", "read_total", "scroll", "select", "type",
      ].sort(),
    );
  });

  it("every tool def has a JSON-schema object for parameters", () => {
    for (const t of buildToolset({ dryRun: true })) {
      expect(t.def.parameters).toMatchObject({ type: "object" });
      expect(typeof t.def.description).toBe("string");
    }
  });
});

describe("fill_card — money guard", () => {
  it("REFUSES on a dry-run (no-spend) and never touches the page", async () => {
    const res = await tool("fill_card").run(ctx({ dryRun: true }), {});
    expect(res.text).toMatch(/REFUSED/);
    expect(res.text).toMatch(/parked_payment/);
    expect(res.finish).toBeUndefined();
  });
});

describe("type — secret boundary", () => {
  it("refuses to type a protected secret variable (x_login_password) without touching the page", async () => {
    const res = await tool("type").run(ctx(), { ref: 2, var: "x_login_password" });
    expect(res.text).toMatch(/protected secret field/);
  });

  it("reports a missing value for an unknown variable", async () => {
    const res = await tool("type").run(ctx(), { ref: 2, var: "x_unknown" });
    expect(res.text).toMatch(/no value/);
  });

  it("requires a ref", async () => {
    const res = await tool("type").run(ctx(), { var: "x_shipping_email" });
    expect(res.text).toMatch(/ref is required/);
  });
});

describe("click — argument validation", () => {
  it("asks for ref or coordinates when given neither", async () => {
    const res = await tool("click").run(ctx(), {});
    expect(res.text).toMatch(/ref/);
    expect(res.text).toMatch(/x.*y|coordinates/);
    expect(res.ok).toBe(false);
  });
});

describe("login — guest no-op", () => {
  it("returns a guest message when no account is configured (no page access)", async () => {
    const res = await tool("login").run(ctx(), {});
    expect(res.text).toMatch(/no account is configured/);
  });

  it("returns a guest message for a guest strategy", async () => {
    const res = await tool("login").run(
      ctx({ loginPlan: { strategy: "guest", email: "", domain: "example.com" } }),
      {},
    );
    expect(res.text).toMatch(/guest/);
  });
});

describe("finish — terminal signal", () => {
  it("returns a finish marker with the chosen status and fields", async () => {
    const res = await tool("finish").run(ctx(), {
      status: "confirmation", order_number: "ABC123", total: "$42.00",
    });
    expect(res.finish).toEqual({
      status: "confirmation", orderNumber: "ABC123", total: "$42.00", note: undefined,
    });
  });

  it("defaults an unknown status to stopped", async () => {
    const res = await tool("finish").run(ctx(), {});
    expect(res.finish?.status).toBe("stopped");
  });
});

describe("scroll / press — simple page primitives", () => {
  it("scroll delegates to the page and reports the direction", async () => {
    const page: any = { evaluate: vi.fn().mockResolvedValue(undefined), waitForTimeout: vi.fn().mockResolvedValue(undefined) };
    const res = await tool("scroll").run(ctx({ page }), { direction: "down" });
    expect(res.text).toMatch(/down/);
    expect(page.evaluate).toHaveBeenCalled();
  });

  it("press requires a key", async () => {
    const page: any = { keyboard: { press: vi.fn() }, waitForTimeout: vi.fn() };
    const res = await tool("press").run(ctx({ page }), {});
    expect(res.text).toMatch(/provide a key/);
    expect(page.keyboard.press).not.toHaveBeenCalled();
  });
});
