import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mock LLM + grounding (Exa/discovery) ----

const { completeJsonMock, getKeyMock, searchQueryMock, queryMock } = vi.hoisted(
  () => ({
    completeJsonMock: vi.fn(),
    getKeyMock: vi.fn(() => "or-key" as string | null),
    searchQueryMock: vi.fn(),
    queryMock: vi.fn(),
  }),
);

vi.mock("@tomo/identity", () => ({
  completeJson: (...a: unknown[]) => completeJsonMock(...a),
  getOpenRouterKey: () => getKeyMock(),
}));

vi.mock("@tomo/orchestrator", () => ({
  searchQuery: (...a: unknown[]) => searchQueryMock(...a),
  query: (...a: unknown[]) => queryMock(...a),
}));

import { buildBrief, fallbackBrief } from "../src/brief.js";

beforeEach(() => {
  completeJsonMock.mockReset();
  searchQueryMock.mockReset();
  queryMock.mockReset();
  getKeyMock.mockReturnValue("or-key");
});

describe("fallbackBrief (no LLM)", () => {
  it("produces a structured brief from a bare URL task", () => {
    const b = fallbackBrief("buy https://shop.example/p/1");
    expect(b.objective).toContain("shop.example/p/1");
    expect(b.target.domain).toBe("shop.example");
    expect(b.target.url).toBe("https://shop.example/p/1");
    expect(Array.isArray(b.execution_steps)).toBe(true);
    expect(b.grounding?.method).toBe("fallback");
  });

  it("produces a brief with no target url for a vague NL task", () => {
    const b = fallbackBrief("book a flight from DEN to SFO");
    expect(b.objective).toContain("DEN to SFO");
    expect(b.target.url).toBe("");
    expect(b.login.type).toBe("unknown");
  });
});

describe("buildBrief (grounded + LLM)", () => {
  it("grounds an NL task via Exa/discovery and synthesizes a high-detail brief", async () => {
    searchQueryMock.mockResolvedValue({
      type: "search",
      query: "gowild pass DEN to SFO",
      products: [
        {
          product: {
            name: "Frontier GoWild Booking",
            url: "https://flyfrontier.com/gowild/book",
            price: "0.01",
          },
          options: [],
          required_fields: [],
          discovery_method: "exa",
          relevance_score: 0.9,
        },
      ],
      search_metadata: { total_found: 1 },
    });
    completeJsonMock.mockResolvedValue({
      objective: "Book earliest morning GoWild standby DEN→SFO tomorrow",
      site: "Frontier Airlines GoWild",
      url: "https://flyfrontier.com/gowild/book",
      domain: "flyfrontier.com",
      login: { required: true, type: "email_otp", notes: "Frontier OTP to account email" },
      parameters: { origin: "DEN", destination: "SFO", time_window: "morning", fare_type: "GoWild standby" },
      constraints: ["pick earliest departure after 5am"],
      execution_steps: ["Navigate to GoWild booking", "Set DEN to SFO", "Pick earliest morning flight"],
      resolve_live: ["exact flight number", "exact departure time"],
    });

    const b = await buildBrief(
      "book the earliest gowild pass tomorrow morning from DEN to SFO",
    );

    // Grounding ran and surfaced the real candidate.
    expect(searchQueryMock).toHaveBeenCalledOnce();
    expect(b.grounding?.method).toBe("exa+discovery");
    expect(b.grounding?.candidates?.[0]?.url).toBe("https://flyfrontier.com/gowild/book");

    // Synthesized high-detail fields.
    expect(b.target.site).toBe("Frontier Airlines GoWild");
    expect(b.target.domain).toBe("flyfrontier.com");
    expect(b.login.type).toBe("email_otp");
    expect(b.parameters.origin).toBe("DEN");
    expect(b.execution_steps.length).toBeGreaterThan(0);
    expect(b.resolve_live).toContain("exact flight number");
  });

  it("grounds a URL task via discovery (query), not search", async () => {
    queryMock.mockResolvedValue({
      product: { name: "Sneakers", url: "https://shop.example/p/1", price: "100.00", source: "x" },
      options: [],
      discovery_method: "test",
    });
    completeJsonMock.mockResolvedValue({
      objective: "Buy Sneakers",
      site: "shop.example",
      url: "https://shop.example/p/1",
      domain: "shop.example",
      login: { required: false, type: "none" },
      parameters: {},
      constraints: [],
      execution_steps: ["Add to cart", "Checkout"],
      resolve_live: [],
    });

    const b = await buildBrief("buy https://shop.example/p/1");
    expect(queryMock).toHaveBeenCalledOnce();
    expect(searchQueryMock).not.toHaveBeenCalled();
    expect(b.grounding?.method).toBe("url-fetch");
    expect(b.target.url).toBe("https://shop.example/p/1");
  });

  it("falls back deterministically when there is no OpenRouter key", async () => {
    getKeyMock.mockReturnValue(null);
    const b = await buildBrief("buy https://shop.example/p/1");
    expect(completeJsonMock).not.toHaveBeenCalled();
    expect(b.grounding?.method).toBe("fallback");
    expect(b.target.domain).toBe("shop.example");
  });

  it("falls back deterministically when the LLM throws", async () => {
    searchQueryMock.mockResolvedValue({ products: [], search_metadata: { total_found: 0 } });
    completeJsonMock.mockRejectedValue(new Error("LLM down"));
    const b = await buildBrief("book a flight DEN to SFO");
    expect(b.grounding?.method).toBe("fallback");
    expect(b.objective).toContain("DEN to SFO");
  });

  it("never crashes when grounding throws — degrades to llm-only synthesis", async () => {
    searchQueryMock.mockRejectedValue(new Error("Exa down"));
    completeJsonMock.mockResolvedValue({
      objective: "Book a flight DEN to SFO",
      site: "Unknown",
      url: "",
      domain: "",
      login: { required: true, type: "unknown" },
      parameters: { origin: "DEN", destination: "SFO" },
      constraints: [],
      execution_steps: ["Find a booking site"],
      resolve_live: ["booking URL"],
    });
    const b = await buildBrief("book a flight DEN to SFO");
    expect(b.grounding?.method).toBe("llm-only");
    expect(b.parameters.origin).toBe("DEN");
  });
});
