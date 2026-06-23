/**
 * LLM narration for the "Learnings & gotchas" section of SKILL.md.
 *
 * SECURITY (prime directive): this module never imports the credentials/CDP
 * path. Its only input is a SiteSkillRecord, and it builds the prompt from a
 * whitelisted projection (`buildNarrationFacts`) that carries page types, field
 * labels, and selector strings only — there is no key that can hold a card PAN,
 * CVV, password, or session token. The LLM therefore cannot receive a secret
 * value through this feature.
 */
import { completePrompt } from "./llm.js";
import type { SiteSkillRecord } from "./skill-types.js";

const SYSTEM_PROMPT = [
  "You are documenting how an automated checkout agent completes a purchase on a website.",
  "Given the page-type flow and the CSS selectors that matched, write 2-4 sentences of",
  "practical, concrete gotchas for re-running checkout on this site (e.g. interstitials,",
  "split fields, redirects, fragile steps). Be specific and terse.",
  "NEVER invent credentials, card numbers, or personal data. Output prose only — no markdown headings.",
].join(" ");

/** Sanitized projection fed to the LLM. Only labels + selectors — never values. */
export interface NarrationFacts {
  readonly domain: string;
  readonly flow: readonly string[];
  readonly selectors: ReadonlyArray<{
    readonly pageType: string;
    readonly action: string;
    readonly field: string;
    readonly selector: string;
    readonly mode: string;
  }>;
}

/** Build the whitelisted fact projection. Pure + independently testable. */
export function buildNarrationFacts(record: SiteSkillRecord): NarrationFacts {
  return {
    domain: record.domain,
    flow: record.pageFlow.map((f) => f.pageType),
    selectors: record.selectors.map((s) => ({
      pageType: s.pageType,
      action: s.action,
      field: s.fieldLabel,
      selector: s.matchedSelector,
      mode: s.mode,
    })),
  };
}

/**
 * Generate the "Learnings & gotchas" prose. Returns undefined on any failure
 * (missing API key, network, rate limit) so the skill still writes without it.
 */
export async function narrateLearnings(record: SiteSkillRecord): Promise<string | undefined> {
  try {
    const facts = buildNarrationFacts(record);
    const out = await completePrompt(SYSTEM_PROMPT, JSON.stringify(facts), {
      maxTokens: 400,
      temperature: 0.2,
    });
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 2000) : undefined;
  } catch {
    return undefined;
  }
}
