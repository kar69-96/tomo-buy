import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Mock AgentMail so no network is touched; the test controls what inbox is returned.
vi.mock("../src/agentmail.js", () => ({
  provisionInbox: vi.fn(),
}));

import { provisionInbox } from "../src/agentmail.js";
import { getOrCreateAgentIdentity } from "../src/agent-identity.js";
import { createIdentity, getIdentity } from "@tomo/core";

let dir: string;
const origDataDir = process.env.TOMO_DATA_DIR;
const origKey = process.env.AGENTMAIL_API_KEY;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tomo-identity-"));
  process.env.TOMO_DATA_DIR = dir;
});

afterAll(() => {
  if (origDataDir === undefined) delete process.env.TOMO_DATA_DIR;
  else process.env.TOMO_DATA_DIR = origDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.mocked(provisionInbox).mockReset();
  delete process.env.AGENTMAIL_API_KEY;
});

afterEach(() => {
  if (origKey === undefined) delete process.env.AGENTMAIL_API_KEY;
  else process.env.AGENTMAIL_API_KEY = origKey;
});

describe("getOrCreateAgentIdentity self-heal", () => {
  it("upgrades a @tomo.local placeholder email to a real inbox when AgentMail is configured", async () => {
    await createIdentity({
      identity_id: "id_heal",
      label: "heal-test",
      email: "agent+id_heal@tomo.local",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    process.env.AGENTMAIL_API_KEY = "am_test";
    vi.mocked(provisionInbox).mockResolvedValue({
      inboxId: "tomobuy@agentmail.to",
      email: "tomobuy@agentmail.to",
    });

    const id = await getOrCreateAgentIdentity("heal-test");
    expect(id.email).toBe("tomobuy@agentmail.to");
    expect(id.inbox_id).toBe("tomobuy@agentmail.to");
    // Persisted, not just returned.
    expect(getIdentity("id_heal")?.email).toBe("tomobuy@agentmail.to");
  });

  it("leaves the placeholder untouched when AgentMail is not configured", async () => {
    await createIdentity({
      identity_id: "id_noheal",
      label: "noheal-test",
      email: "agent+id_noheal@tomo.local",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    const id = await getOrCreateAgentIdentity("noheal-test");
    expect(id.email).toBe("agent+id_noheal@tomo.local");
    expect(provisionInbox).not.toHaveBeenCalled();
  });
});
