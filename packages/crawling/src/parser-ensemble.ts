import { isValidPrice } from "./helpers.js";
import type { FirecrawlExtract } from "./types.js";

export interface CandidateInput {
  source: string;
  extract: FirecrawlExtract | null | undefined;
}

export interface RankedCandidate {
  source: string;
  extract: FirecrawlExtract;
  confidence: number;
  reasons: string[];
}

function cleanText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return undefined;
  return trimmed;
}

function optionSignalScore(extract: FirecrawlExtract): number {
  const options = extract.options ?? [];
  if (options.length === 0) return 0;
  let populated = 0;
  for (const opt of options) {
    if (cleanText(opt.name) && (opt.values ?? []).length > 0) populated++;
  }
  return Math.min(1, populated / Math.max(1, options.length));
}

/**
 * Scores extraction candidates using generic signals only (no site/domain rules).
 */
export function rankCandidate(input: CandidateInput): RankedCandidate | null {
  const extract = input.extract;
  if (!extract) return null;

  const name = cleanText(extract.name);
  const price = cleanText(extract.price);
  const description = cleanText(extract.description);
  const imageUrl = cleanText(extract.image_url);
  const currency = cleanText(extract.currency);
  const variantUrls = (extract.variant_urls ?? []).filter((u) => /^https?:\/\//.test(u));

  if (!name && !price) return null;

  const reasons: string[] = [];
  let score = 0;

  if (name) {
    score += 0.35;
    reasons.push("name");
  }

  if (price && isValidPrice(price)) {
    score += 0.45;
    reasons.push("price_valid");
  } else if (price) {
    score += 0.1;
    reasons.push("price_weak");
  }

  const optionsScore = optionSignalScore(extract);
  if (optionsScore > 0) {
    score += 0.1 * optionsScore;
    reasons.push("options");
  }

  if (variantUrls.length > 0) {
    score += 0.05;
    reasons.push("variant_urls");
  }

  if (description) {
    score += 0.03;
    reasons.push("description");
  }

  if (imageUrl) {
    score += 0.01;
    reasons.push("image");
  }

  if (currency) {
    score += 0.01;
    reasons.push("currency");
  }

  // Slight source prior for browser-rendered or Exa-extracted data on hard pages.
  if (input.source === "browserbase" || input.source === "exa") {
    score += 0.02;
  }

  return {
    source: input.source,
    extract,
    confidence: Math.max(0, Math.min(1, score)),
    reasons,
  };
}

export function chooseBestCandidate(
  candidates: CandidateInput[],
): RankedCandidate | null {
  let best: RankedCandidate | null = null;
  for (const candidate of candidates) {
    const ranked = rankCandidate(candidate);
    if (!ranked) continue;
    if (!best || ranked.confidence > best.confidence) {
      best = ranked;
    }
  }
  return best;
}
