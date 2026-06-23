import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { discoverViaBrowser } from "../src/discover.js";

// Mock the session module
vi.mock("../src/session.js", () => ({
  getBrowserbaseConfig: vi.fn(),
  getModelApiKey: vi.fn(),
  getQueryModelApiKey: vi.fn(),
  createSession: vi.fn(),
  destroySession: vi.fn(),
}));

// Mock Stagehand
const mockExtract = vi.fn();
const mockClose = vi.fn();
const mockGoto = vi.fn();
const mockWaitForTimeout = vi.fn();
const mockEvaluate = vi.fn();

vi.mock("@browserbasehq/stagehand", () => ({
  Stagehand: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    context: {
      activePage: () => ({
        goto: mockGoto.mockResolvedValue(undefined),
        waitForTimeout: mockWaitForTimeout.mockResolvedValue(undefined),
        evaluate: mockEvaluate.mockResolvedValue(undefined),
      }),
    },
    extract: mockExtract,
    close: mockClose.mockResolvedValue(undefined),
  })),
}));

// Import mocked modules
import { getBrowserbaseConfig, getModelApiKey, getQueryModelApiKey, createSession, destroySession } from "../src/session.js";

const mockGetBrowserbaseConfig = vi.mocked(getBrowserbaseConfig);
const mockGetModelApiKey = vi.mocked(getModelApiKey);
const mockGetQueryModelApiKey = vi.mocked(getQueryModelApiKey);
const mockCreateSession = vi.mocked(createSession);
const mockDestroySession = vi.mocked(destroySession);

describe("discoverViaBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBrowserbaseConfig.mockReturnValue({ apiKey: "test-key", projectId: "test-project" });
    mockGetModelApiKey.mockReturnValue("test-google-key");
    mockGetQueryModelApiKey.mockReturnValue("test-google-query-key");
    mockCreateSession.mockResolvedValue({
      id: "session-123",
      connectUrl: "wss://connect.example.com",
      replayUrl: "https://browserbase.com/sessions/session-123",
    });
    // Set env vars so Stagehand constructor works
    process.env.BROWSERBASE_API_KEY = "test-key";
    process.env.BROWSERBASE_PROJECT_ID = "test-project";
  });

  afterEach(() => {
    delete process.env.BROWSERBASE_API_KEY;
    delete process.env.BROWSERBASE_PROJECT_ID;
  });

  it("returns null when BROWSERBASE_API_KEY is missing", async () => {
    mockGetBrowserbaseConfig.mockImplementation(() => {
      throw new Error("BROWSERBASE_API_KEY is required");
    });

    const result = await discoverViaBrowser("https://example.com/product");
    expect(result).toBeNull();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("returns null when GOOGLE_API_KEY_QUERY is missing", async () => {
    mockGetQueryModelApiKey.mockImplementation(() => {
      throw new Error("GOOGLE_API_KEY_QUERY is required");
    });

    const result = await discoverViaBrowser("https://example.com/product");
    expect(result).toBeNull();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("returns null when session creation fails", async () => {
    mockCreateSession.mockRejectedValue(new Error("Session creation failed"));

    const result = await discoverViaBrowser("https://example.com/product");
    expect(result).toBeNull();
  });

  it("maps extracted data to FullDiscoveryResult", async () => {
    mockExtract.mockResolvedValue({
      name: "Amazon Basics Bed Sheets",
      price: "$29.99",
      original_price: "$39.99",
      currency: "USD",
      brand: "Amazon Basics",
      image_url: "https://img.example.com/sheets.jpg",
      options: [
        { name: "Size", values: ["Twin", "Queen", "King"], prices: { "Twin": "$24.99", "Queen": "$29.99", "King": "$34.99" } },
        { name: "Color", values: ["White", "Navy"] },
      ],
    });

    const result = await discoverViaBrowser("https://www.amazon.com/dp/B00Q7OAKV2");

    expect(result).not.toBeNull();
    expect(result!.name).toBe("Amazon Basics Bed Sheets");
    expect(result!.price).toBe("29.99");
    expect(result!.original_price).toBe("39.99");
    expect(result!.currency).toBe("USD");
    expect(result!.brand).toBe("Amazon Basics");
    expect(result!.image_url).toBe("https://img.example.com/sheets.jpg");
    expect(result!.method).toBe("browserbase");
    expect(result!.options).toHaveLength(2);
    expect(result!.options[0].name).toBe("Size");
    expect(result!.options[0].prices).toEqual({ "Twin": "24.99", "Queen": "29.99", "King": "34.99" });
    expect(result!.options[1].name).toBe("Color");
    expect(result!.options[1].prices).toBeUndefined();

    // Verify session cleanup
    expect(mockDestroySession).toHaveBeenCalledWith("session-123");
  });

  it("returns null when extract returns empty name", async () => {
    mockExtract.mockResolvedValue({
      name: "",
      price: "$10.00",
    });

    const result = await discoverViaBrowser("https://example.com/product");
    expect(result).toBeNull();
    expect(mockDestroySession).toHaveBeenCalledWith("session-123");
  });

  it("returns null when extract returns empty price", async () => {
    mockExtract.mockResolvedValue({
      name: "Product",
      price: "",
    });

    const result = await discoverViaBrowser("https://example.com/product");
    expect(result).toBeNull();
    expect(mockDestroySession).toHaveBeenCalledWith("session-123");
  });

  it("destroys session even when extract throws", async () => {
    mockExtract.mockRejectedValue(new Error("Extraction failed"));

    const result = await discoverViaBrowser("https://example.com/product");
    expect(result).toBeNull();
    expect(mockClose).toHaveBeenCalled();
    expect(mockDestroySession).toHaveBeenCalledWith("session-123");
  });

  it("handles missing optional fields gracefully", async () => {
    mockExtract.mockResolvedValue({
      name: "Simple Product",
      price: "15.00",
    });

    const result = await discoverViaBrowser("https://example.com/product");

    expect(result).not.toBeNull();
    expect(result!.name).toBe("Simple Product");
    expect(result!.price).toBe("15.00");
    expect(result!.method).toBe("browserbase");
    expect(result!.options).toEqual([]);
    expect(result!.original_price).toBeUndefined();
    expect(result!.currency).toBeUndefined();
    expect(result!.brand).toBeUndefined();
  });
});
