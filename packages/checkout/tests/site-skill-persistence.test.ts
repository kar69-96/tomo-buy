import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadSiteSkill,
  writeSiteSkill,
  sanitizeDomainForPath,
  findSkillRoot,
} from "../src/site-skill.js";
import type { SiteSkillRecord } from "../src/skill-types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tomo-skill-test-"));
  process.env.TOMO_SKILLS_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.TOMO_SKILLS_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function record(): SiteSkillRecord {
  return {
    domain: "shop.example.com",
    version: 1,
    successCount: 1,
    createdAt: "2026-06-23T00:00:00.000Z",
    lastVerifiedAt: "2026-06-23T00:00:00.000Z",
    pageFlow: [{ index: 0, pageType: "product", urlPath: "/p" }],
    selectors: [
      {
        pageType: "product", action: "click-button", fieldLabel: "add to cart",
        matchedSelector: 'button[name="add"]', provenance: "STRUCTURAL", mode: "scripted",
      },
    ],
    schema: 1,
  };
}

describe("writeSiteSkill / loadSiteSkill", () => {
  it("creates site-skills/{domain}/{SKILL.md,skill.json} and round-trips", () => {
    const rec = record();
    writeSiteSkill(rec, "# hello\n");

    const dir = path.join(tmpDir, "site-skills", "shop.example.com");
    expect(fs.existsSync(path.join(dir, "skill.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "SKILL.md"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "SKILL.md"), "utf-8")).toBe("# hello\n");

    const loaded = loadSiteSkill("shop.example.com");
    expect(loaded).not.toBeNull();
    expect(loaded?.domain).toBe("shop.example.com");
    expect(loaded?.selectors).toHaveLength(1);
  });

  it("returns null for a missing domain", () => {
    expect(loadSiteSkill("never-seen.com")).toBeNull();
  });

  it("leaves no .tmp files behind", () => {
    writeSiteSkill(record(), "# x\n");
    const dir = path.join(tmpDir, "site-skills", "shop.example.com");
    expect(fs.readdirSync(dir).some((f) => f.endsWith(".tmp"))).toBe(false);
  });
});

describe("sanitizeDomainForPath", () => {
  it("rejects path traversal and slashes", () => {
    expect(sanitizeDomainForPath("../evil")).not.toContain("..");
    expect(sanitizeDomainForPath("a/b")).not.toContain("/");
  });

  it("preserves a normal hostname", () => {
    expect(sanitizeDomainForPath("shop.example.com")).toBe("shop.example.com");
  });
});

describe("findSkillRoot", () => {
  it("honors the TOMO_SKILLS_DIR override", () => {
    expect(findSkillRoot()).toBe(tmpDir);
  });

  it("walks up to pnpm-workspace.yaml when no override is set", () => {
    delete process.env.TOMO_SKILLS_DIR;
    const root = findSkillRoot();
    expect(fs.existsSync(path.join(root, "pnpm-workspace.yaml"))).toBe(true);
  });
});
