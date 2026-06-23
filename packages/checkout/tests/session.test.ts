import { describe, it, expect } from "vitest";
import {
  getBrowserbaseConfig,
  createSession,
  destroySession,
} from "../src/session.js";

describe("getBrowserbaseConfig", () => {
  it("returns config when env vars are set", () => {
    const savedKey = process.env.BROWSERBASE_API_KEY;
    const savedProject = process.env.BROWSERBASE_PROJECT_ID;

    process.env.BROWSERBASE_API_KEY = "bb_test_key";
    process.env.BROWSERBASE_PROJECT_ID = "proj_test_123";

    try {
      const config = getBrowserbaseConfig();
      expect(config.apiKey).toBe("bb_test_key");
      expect(config.projectId).toBe("proj_test_123");
    } finally {
      if (savedKey === undefined) delete process.env.BROWSERBASE_API_KEY;
      else process.env.BROWSERBASE_API_KEY = savedKey;
      if (savedProject === undefined)
        delete process.env.BROWSERBASE_PROJECT_ID;
      else process.env.BROWSERBASE_PROJECT_ID = savedProject;
    }
  });

  it("throws when BROWSERBASE_API_KEY is missing", () => {
    const savedKey = process.env.BROWSERBASE_API_KEY;
    const savedProject = process.env.BROWSERBASE_PROJECT_ID;

    delete process.env.BROWSERBASE_API_KEY;
    process.env.BROWSERBASE_PROJECT_ID = "proj_test_123";

    try {
      expect(() => getBrowserbaseConfig()).toThrow("BROWSERBASE_API_KEY");
    } finally {
      if (savedKey === undefined) delete process.env.BROWSERBASE_API_KEY;
      else process.env.BROWSERBASE_API_KEY = savedKey;
      if (savedProject === undefined)
        delete process.env.BROWSERBASE_PROJECT_ID;
      else process.env.BROWSERBASE_PROJECT_ID = savedProject;
    }
  });

  it("throws when BROWSERBASE_PROJECT_ID is missing", () => {
    const savedKey = process.env.BROWSERBASE_API_KEY;
    const savedProject = process.env.BROWSERBASE_PROJECT_ID;

    process.env.BROWSERBASE_API_KEY = "bb_test_key";
    delete process.env.BROWSERBASE_PROJECT_ID;

    try {
      expect(() => getBrowserbaseConfig()).toThrow("BROWSERBASE_PROJECT_ID");
    } finally {
      if (savedKey === undefined) delete process.env.BROWSERBASE_API_KEY;
      else process.env.BROWSERBASE_API_KEY = savedKey;
      if (savedProject === undefined)
        delete process.env.BROWSERBASE_PROJECT_ID;
      else process.env.BROWSERBASE_PROJECT_ID = savedProject;
    }
  });
});

// ---- Network tests (require real Browserbase credentials) ----

describe.skipIf(!process.env.BROWSERBASE_API_KEY)(
  "Browserbase session (network)",
  () => {
    it("creates and destroys a session", async () => {
      let session;
      try {
        session = await createSession();
      } catch (e) {
        // Skip gracefully on billing limits (free plan minutes exhausted)
        if (e instanceof Error && e.message.includes("402")) {
          console.log("Skipping: Browserbase free plan minutes exhausted");
          return;
        }
        throw e;
      }
      expect(session.id).toBeTruthy();
      expect(session.connectUrl).toBeTruthy();
      expect(session.replayUrl).toContain(session.id);

      // Destroy should not throw
      await destroySession(session.id);
    }, 30000);
  },
);
