/**
 * Persistence, repo-root resolution, merge, and read-back hints for per-site
 * checkout skills. Analogue of cache.ts, but writes COMMITTED files into the
 * repo (`site-skills/{domain}/`) rather than the secret-bearing `~/.tomo`.
 *
 * Two artifacts per domain:
 *   - skill.json  — the structured SiteSkillRecord (source of truth)
 *   - SKILL.md    — the rendered human/LLM doc
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { PageType } from "@tomo/core";
import {
  type SiteSkillRecord,
  type RecordedSelector,
  type SkillActionKind,
  SKILL_DIR_NAME,
} from "./skill-types.js";

// ---- Repo-root resolution (reliable regardless of cwd) ----

/**
 * Resolve the directory that holds `site-skills/`. Honors TOMO_SKILLS_DIR
 * (test seam / container override, mirrors TOMO_DATA_DIR), else walks up from
 * this module to the workspace root (pnpm-workspace.yaml), else falls back to cwd.
 */
export function findSkillRoot(): string {
  if (process.env.TOMO_SKILLS_DIR) return process.env.TOMO_SKILLS_DIR;
  let dir: string;
  try {
    dir = path.dirname(fileURLToPath(import.meta.url));
  } catch {
    dir = process.cwd();
  }
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Whitelist hostname chars and reject path-traversal before using a domain as a folder name. */
export function sanitizeDomainForPath(domain: string): string {
  const cleaned = domain.toLowerCase().replace(/[^a-z0-9.-]/g, "_");
  if (cleaned.includes("..") || cleaned === "" || cleaned === "." || cleaned.startsWith("_")) {
    return cleaned.replace(/\.\./g, "_").replace(/^[._]+/, "site_") || "site_unknown";
  }
  return cleaned;
}

function skillDir(domain: string): string {
  return path.join(findSkillRoot(), SKILL_DIR_NAME, sanitizeDomainForPath(domain));
}

function jsonPath(domain: string): string {
  return path.join(skillDir(domain), "skill.json");
}

function markdownPath(domain: string): string {
  return path.join(skillDir(domain), "SKILL.md");
}

// ---- Load / write ----

export function loadSiteSkill(domain: string): SiteSkillRecord | null {
  try {
    const data = fs.readFileSync(jsonPath(domain), "utf-8");
    const parsed = JSON.parse(data) as SiteSkillRecord;
    if (!parsed || typeof parsed.domain !== "string" || !Array.isArray(parsed.selectors)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function atomicWrite(filePath: string, content: string): void {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

/** Write both skill.json and SKILL.md atomically. Committed files → default repo perms. */
export function writeSiteSkill(record: SiteSkillRecord, markdown: string): void {
  const dir = skillDir(record.domain);
  fs.mkdirSync(dir, { recursive: true });
  atomicWrite(jsonPath(record.domain), JSON.stringify(record, null, 2) + "\n");
  atomicWrite(markdownPath(record.domain), markdown);
}

// ---- Merge (accumulate across runs; never lose prior learnings) ----

function selectorKey(s: RecordedSelector): string {
  return `${s.pageType}|${s.action}|${s.fieldLabel}|${s.matchedSelector}`;
}

/** Union of two selector lists, `fresh` first so the most-recent ordering wins in read-back. */
function unionSelectors(
  fresh: readonly RecordedSelector[],
  existing: readonly RecordedSelector[],
): RecordedSelector[] {
  const seen = new Set<string>();
  const out: RecordedSelector[] = [];
  for (const s of [...fresh, ...existing]) {
    const key = selectorKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Merge a fresh run's record into the existing committed one. Pure/immutable.
 * Bumps version + successCount, unions selectors (A/B variants both survive),
 * keeps the newer/longer page flow, and preserves prior learnings if the fresh
 * narration is absent.
 */
export function mergeSiteSkill(
  existing: SiteSkillRecord | null,
  fresh: SiteSkillRecord,
): SiteSkillRecord {
  if (!existing) return fresh;
  return {
    ...existing,
    version: existing.version + 1,
    successCount: existing.successCount + 1,
    lastVerifiedAt: fresh.lastVerifiedAt,
    selectors: unionSelectors(fresh.selectors, existing.selectors),
    pageFlow: fresh.pageFlow.length >= existing.pageFlow.length ? fresh.pageFlow : existing.pageFlow,
    learnings: fresh.learnings ?? existing.learnings,
    schema: fresh.schema,
  };
}

// ---- Read-back hints ----

/** A recorded selector usable as a CSS selector (not a `text=` fallback descriptor). */
function isCssSelector(selector: string): boolean {
  return !selector.startsWith("text=");
}

/**
 * Structured, lookup-friendly view of a skill's selectors for read-back.
 * Built once at run start and consulted before the generic selector groups.
 */
export class SelectorHints {
  private readonly clickByPage = new Map<PageType, string[]>();
  private readonly fillByField = new Map<string, string[]>();

  constructor(record: SiteSkillRecord | null) {
    if (!record) return;
    for (const s of record.selectors) {
      if (s.action === "click-button" || s.action === "select-option") {
        if (!isCssSelector(s.matchedSelector)) continue;
        const list = this.clickByPage.get(s.pageType) ?? [];
        if (!list.includes(s.matchedSelector)) list.push(s.matchedSelector);
        this.clickByPage.set(s.pageType, list);
      } else {
        // fill-shipping / fill-card / fill-billing / fill-otp keyed by label
        const key = this.fillKey(s.action, s.fieldLabel);
        const list = this.fillByField.get(key) ?? [];
        if (!list.includes(s.matchedSelector)) list.push(s.matchedSelector);
        this.fillByField.set(key, list);
      }
    }
  }

  private fillKey(action: SkillActionKind, fieldLabel: string): string {
    return `${action}|${fieldLabel}`;
  }

  /** Known CSS selectors for clickable/selectable elements on a given page type. */
  forClick(pageType: PageType): string[] {
    return this.clickByPage.get(pageType) ?? [];
  }

  /** Known selectors for a fill field (e.g. fill-shipping "email"). */
  forFill(action: SkillActionKind, fieldLabel: string): string[] {
    return this.fillByField.get(this.fillKey(action, fieldLabel)) ?? [];
  }

  /** All fill hints for an action as a `{ fieldLabel: selectors[] }` map (for scripted fill). */
  fillHintsFor(action: SkillActionKind): Record<string, string[]> {
    const prefix = `${action}|`;
    const out: Record<string, string[]> = {};
    for (const [key, selectors] of this.fillByField) {
      if (key.startsWith(prefix)) out[key.slice(prefix.length)] = selectors;
    }
    return out;
  }

  /** True when there is nothing to prime from. */
  get isEmpty(): boolean {
    return this.clickByPage.size === 0 && this.fillByField.size === 0;
  }
}

/** Build read-back hints from a (possibly null) loaded skill. */
export function buildSelectorHints(record: SiteSkillRecord | null): SelectorHints {
  return new SelectorHints(record);
}
