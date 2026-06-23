import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock session and Stagehand before importing the module under test
const mockInit = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockExecute = vi.fn();
const mockAgent = vi.fn();
const mockGoto = vi.fn().mockResolvedValue(undefined);
const mockWaitForTimeout = vi.fn().mockResolvedValue(undefined);
const mockEvaluate = vi.fn().mockResolvedValue(undefined);

const mockPage = {
  goto: mockGoto,
  waitForTimeout: mockWaitForTimeout,
  evaluate: mockEvaluate,
};

vi.mock("@browserbasehq/stagehand", () => ({
  Stagehand: vi.fn().mockImplementation(() => ({
    init: mockInit,
    close: mockClose,
    agent: mockAgent,
    context: { activePage: () => mockPage },
  })),
}));

vi.mock("../src/session.js", () => ({
  createSession: vi.fn().mockResolvedValue({ id: "test-session-id", connectUrl: "", replayUrl: "" }),
  destroySession: vi.fn().mockResolvedValue(undefined),
  getModelApiKey: vi.fn().mockReturnValue("test-api-key"),
  getQueryModelApiKey: vi.fn().mockReturnValue("test-query-api-key"),
  getBrowserbaseConfig: vi.fn().mockReturnValue({ apiKey: "bb-key", projectId: "bb-proj" }),
}));

import { fetchVariantPriceBrowser, resolveVariantPricesViaBrowser } from "../src/discover.js";
import { createSession, destroySession } from "../src/session.js";

describe("fetchVariantPriceBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BROWSERBASE_API_KEY = "bb-key";
    process.env.BROWSERBASE_PROJECT_ID = "bb-proj";
    // Default: agent().execute() returns a price
    mockExecute.mockResolvedValue({ output: { price: "$29.99" } });
    mockAgent.mockReturnValue({ execute: mockExecute });
  });

  it("returns extracted price for a variant", async () => {
    const price = await fetchVariantPriceBrowser(
      "https://example.com/product",
      "Size",
      "Large",
    );

    expect(price).toBe("29.99");
    expect(mockAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "dom",
        systemPrompt: expect.stringContaining("NEVER interact with the quantity selector"),
      }),
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: expect.stringContaining('"Size"'),
        maxSteps: 8,
      }),
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: expect.stringContaining('"Large"'),
      }),
    );
  });

  it("passes VariantPriceSchema as output", async () => {
    await fetchVariantPriceBrowser(
      "https://example.com/product",
      "Size",
      "Large",
    );

    const executeCall = mockExecute.mock.calls[0]![0];
    expect(executeCall.output).toBeDefined();
    // Zod schema — verify it parses correctly
    const parsed = executeCall.output.parse({ price: "$10.00" });
    expect(parsed).toEqual({ price: "$10.00" });
  });

  it("returns null when agent returns empty price", async () => {
    mockExecute.mockResolvedValueOnce({ output: { price: "" } });

    const price = await fetchVariantPriceBrowser(
      "https://example.com/product",
      "Color",
      "Red",
    );

    expect(price).toBeNull();
  });

  it("returns null when agent returns 'null' string", async () => {
    mockExecute.mockResolvedValueOnce({ output: { price: "null" } });

    const price = await fetchVariantPriceBrowser(
      "https://example.com/product",
      "Color",
      "Red",
    );

    expect(price).toBeNull();
  });

  it("returns null when agent execute fails", async () => {
    mockExecute.mockRejectedValueOnce(new Error("agent failed"));

    const price = await fetchVariantPriceBrowser(
      "https://example.com/product",
      "Size",
      "XL",
    );

    expect(price).toBeNull();
  });

  it("returns null when session creation fails", async () => {
    vi.mocked(createSession).mockRejectedValueOnce(new Error("session failed"));

    const price = await fetchVariantPriceBrowser(
      "https://example.com/product",
      "Size",
      "Small",
    );

    expect(price).toBeNull();
  });

  it("destroys session on error", async () => {
    mockExecute.mockRejectedValueOnce(new Error("agent failed"));

    await fetchVariantPriceBrowser(
      "https://example.com/product",
      "Size",
      "Medium",
    );

    expect(destroySession).toHaveBeenCalledWith("test-session-id");
  });

  it("sanitizes option values in instruction", async () => {
    await fetchVariantPriceBrowser(
      "https://example.com/product",
      'Color<script>"alert',
      "Blue&Red;",
    );

    const executeCall = mockExecute.mock.calls[0]![0];
    // Dangerous characters should be stripped
    expect(executeCall.instruction).not.toContain("<");
    expect(executeCall.instruction).not.toContain(">");
    expect(executeCall.instruction).not.toContain('"alert');
    expect(executeCall.instruction).not.toContain("&");
    expect(executeCall.instruction).not.toContain(";");
    expect(executeCall.instruction).toContain("Colorscript");
    expect(executeCall.instruction).toContain("BlueRed");
  });

  it("returns null when agent output is undefined", async () => {
    mockExecute.mockResolvedValueOnce({ output: undefined });

    const price = await fetchVariantPriceBrowser(
      "https://example.com/product",
      "Color",
      "Blue",
    );

    expect(price).toBeNull();
  });
});

describe("resolveVariantPricesViaBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BROWSERBASE_API_KEY = "bb-key";
    process.env.BROWSERBASE_PROJECT_ID = "bb-proj";
    mockAgent.mockReturnValue({ execute: mockExecute });
  });

  it("enriches options with resolved prices", async () => {
    // Mock sequential calls for each variant
    mockExecute
      .mockResolvedValueOnce({ output: { price: "$19.99" } })  // Small
      .mockResolvedValueOnce({ output: { price: "$24.99" } })  // Large
      .mockResolvedValueOnce({ output: { price: "$29.99" } }); // XL

    const options = [
      { name: "Size", values: ["Small", "Large", "XL"] },
    ];

    const result = await resolveVariantPricesViaBrowser(
      "https://example.com/product",
      options,
      5,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.prices).toBeDefined();
    expect(result[0]!.prices!["Small"]).toBe("19.99");
    expect(result[0]!.prices!["Large"]).toBe("24.99");
    expect(result[0]!.prices!["XL"]).toBe("29.99");
  });

  it("skips option groups with complete prices", async () => {
    const options = [
      {
        name: "Size",
        values: ["S", "M"],
        prices: { S: "10.00", M: "12.00" },
      },
    ];

    const result = await resolveVariantPricesViaBrowser(
      "https://example.com/product",
      options,
      5,
    );

    // No Browserbase sessions should have been created
    expect(createSession).not.toHaveBeenCalled();
    expect(result).toEqual(options);
  });

  it("returns original options when no resolution needed", async () => {
    const result = await resolveVariantPricesViaBrowser(
      "https://example.com/product",
      [],
      5,
    );

    expect(result).toEqual([]);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("handles partial failures gracefully", async () => {
    mockExecute
      .mockResolvedValueOnce({ output: { price: "$10.00" } })  // Red succeeds
      .mockRejectedValueOnce(new Error("fail"));               // Blue fails

    const options = [
      { name: "Color", values: ["Red", "Blue"] },
    ];

    const result = await resolveVariantPricesViaBrowser(
      "https://example.com/product",
      options,
      5,
    );

    // Red should have a price, Blue should be absent
    expect(result).toHaveLength(1);
    // Only one price resolved → uniquePrices.size === 1 → prices omitted
    expect(result[0]!.prices).toBeUndefined();
  });

  it("omits prices when all resolved prices are the same", async () => {
    mockExecute
      .mockResolvedValueOnce({ output: { price: "$25.00" } })
      .mockResolvedValueOnce({ output: { price: "$25.00" } });

    const options = [
      { name: "Color", values: ["Red", "Blue"] },
    ];

    const result = await resolveVariantPricesViaBrowser(
      "https://example.com/product",
      options,
      5,
    );

    expect(result[0]!.prices).toBeUndefined();
  });

  it("destroys all sessions even when some fail", async () => {
    mockExecute
      .mockResolvedValueOnce({ output: { price: "$10.00" } })
      .mockRejectedValueOnce(new Error("fail"));

    const options = [
      { name: "Size", values: ["S", "M"] },
    ];

    await resolveVariantPricesViaBrowser(
      "https://example.com/product",
      options,
      5,
    );

    // Both sessions should have been destroyed
    expect(destroySession).toHaveBeenCalledTimes(2);
  });
});
