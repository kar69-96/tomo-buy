import { describe, it, expect, afterEach } from "vitest";
import {
  getComposioClient,
  setComposioClient,
  StubComposioClient,
  buildGmailQuery,
  mapHit,
} from "../src/composio.js";
import type { ComposioClient, EmailHit } from "../src/composio.js";

describe("buildGmailQuery", () => {
  it("composes from, recency, and free-text into Gmail search syntax", () => {
    expect(
      buildGmailQuery({ from: "united.com", newerThanDays: 30, query: "order OR receipt" }),
    ).toBe("from:united.com newer_than:30d (order OR receipt)");
    expect(buildGmailQuery({})).toBe("");
  });
});

describe("mapHit", () => {
  it("maps a raw Gmail message and converts internalDate to ISO", () => {
    const hit = mapHit({
      messageId: "abc",
      sender: "no-reply@united.com",
      subject: "Your trip",
      snippet: "See you soon",
      internalDate: "1735689600000",
    });
    expect(hit.id).toBe("abc");
    expect(hit.from).toBe("no-reply@united.com");
    expect(hit.received_at).toBe(new Date(1735689600000).toISOString());
  });
});

afterEach(() => setComposioClient(null));

describe("StubComposioClient", () => {
  it("reports disconnected and returns nothing", async () => {
    const c = new StubComposioClient();
    expect(await c.isConnected()).toBe(false);
    expect(await c.listConnections()).toEqual([]);
    expect(await c.searchEmail({ from: "amazon.com" })).toEqual([]);
    expect(await c.getMessage("any")).toBeNull();
  });

  it("getComposioClient returns a stub when no key is set", async () => {
    const saved = process.env.COMPOSIO_API_KEY;
    delete process.env.COMPOSIO_API_KEY;
    setComposioClient(null);
    try {
      expect(await getComposioClient().isConnected()).toBe(false);
    } finally {
      if (saved !== undefined) process.env.COMPOSIO_API_KEY = saved;
      setComposioClient(null);
    }
  });

  it("can be overridden with a fake client", async () => {
    const hit: EmailHit = {
      id: "m1",
      from: "no-reply@united.com",
      subject: "Your United account",
      snippet: "Welcome",
      received_at: "2026-01-01T00:00:00Z",
    };
    const fake: ComposioClient = {
      isConnected: async () => true,
      listConnections: async () => [
        { provider: "gmail", email: "user@gmail.com", status: "connected" },
      ],
      searchEmail: async () => [hit],
      getMessage: async () => ({
        id: "m1",
        from: hit.from,
        subject: hit.subject,
        body: "code 482913",
      }),
      getProfileEmail: async () => "user@gmail.com",
    };
    setComposioClient(fake);
    const c = getComposioClient();
    expect(await c.isConnected()).toBe(true);
    expect(await c.searchEmail({ from: "united.com" })).toHaveLength(1);
  });
});
