/**
 * Natural language search query parser.
 * Extracts domain filters, price constraints, and cleaned search terms
 * from free-text queries like "towels on amazon under $15".
 *
 * Deterministic regex — no LLM call needed.
 */

// ---- Domain alias map ----

const DOMAIN_ALIASES: Record<string, string> = {
  amazon: "amazon.com",
  target: "target.com",
  walmart: "walmart.com",
  bestbuy: "bestbuy.com",
  "best buy": "bestbuy.com",
  ebay: "ebay.com",
  etsy: "etsy.com",
  costco: "costco.com",
  homedepot: "homedepot.com",
  "home depot": "homedepot.com",
  lowes: "lowes.com",
  "lowe's": "lowes.com",
  macys: "macys.com",
  "macy's": "macys.com",
  nordstrom: "nordstrom.com",
  wayfair: "wayfair.com",
  zappos: "zappos.com",
  nike: "nike.com",
  adidas: "adidas.com",
  apple: "apple.com",
  sephora: "sephora.com",
  ulta: "ulta.com",
};

// ---- Types ----

export interface ParsedSearchQuery {
  readonly cleanedTerms: string;
  readonly domains: readonly string[];
  readonly minPrice?: number;
  readonly maxPrice?: number;
}

// ---- Price pattern extraction ----

const PRICE_PATTERNS = [
  // "under $15", "below $20", "less than $30"
  { pattern: /(?:under|below|less\s+than|up\s+to|max)\s+\$(\d+(?:\.\d{1,2})?)/i, group: "max" },
  // "over $10", "above $5", "more than $8", "at least $10"
  { pattern: /(?:over|above|more\s+than|at\s+least|min(?:imum)?)\s+\$(\d+(?:\.\d{1,2})?)/i, group: "min" },
  // "$10-$20", "$10 to $20", "$10 - $20"
  { pattern: /\$(\d+(?:\.\d{1,2})?)\s*[-–—]\s*\$(\d+(?:\.\d{1,2})?)/i, group: "range" },
  { pattern: /\$(\d+(?:\.\d{1,2})?)\s+to\s+\$(\d+(?:\.\d{1,2})?)/i, group: "range" },
  // "between $10 and $20"
  { pattern: /between\s+\$(\d+(?:\.\d{1,2})?)\s+and\s+\$(\d+(?:\.\d{1,2})?)/i, group: "range" },
] as const;

// "on amazon", "from target.com", "at walmart"
const DOMAIN_PATTERN = /\b(?:on|from|at)\s+([a-z][a-z0-9'.'\s]*?)(?:\s+(?:under|below|less|over|above|more|between|for|\$)|$)/i;

// Direct domain mention: "amazon.com", "target.com"
const DOMAIN_DIRECT_PATTERN = /\b([a-z][a-z0-9-]*\.(?:com|org|net|co|io))\b/i;

// ---- Parser ----

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  let working = raw.trim();
  let minPrice: number | undefined;
  let maxPrice: number | undefined;
  const domains: string[] = [];

  // Extract price constraints
  for (const { pattern, group } of PRICE_PATTERNS) {
    const match = pattern.exec(working);
    if (!match) continue;

    if (group === "max") {
      maxPrice = parseFloat(match[1]);
    } else if (group === "min") {
      minPrice = parseFloat(match[1]);
    } else if (group === "range") {
      minPrice = parseFloat(match[1]);
      maxPrice = parseFloat(match[2]);
    }
    working = working.replace(match[0], " ");
    if (minPrice !== undefined && maxPrice !== undefined) break;
  }

  // Extract domain from "on/from/at <store>"
  const domainMatch = DOMAIN_PATTERN.exec(working);
  if (domainMatch) {
    const candidate = domainMatch[1].trim().toLowerCase();
    const resolved = DOMAIN_ALIASES[candidate] ?? (candidate.includes(".") ? candidate : undefined);
    if (resolved) {
      domains.push(resolved);
      working = working.replace(domainMatch[0], " ");
    }
  }

  // Extract direct domain mentions (e.g. "amazon.com")
  if (domains.length === 0) {
    const directMatch = DOMAIN_DIRECT_PATTERN.exec(working);
    if (directMatch) {
      domains.push(directMatch[1].toLowerCase());
      working = working.replace(directMatch[0], " ");
    }
  }

  // Clean up
  const cleanedTerms = working
    .replace(/\s+/g, " ")
    .trim();

  return {
    cleanedTerms,
    domains,
    minPrice,
    maxPrice,
  };
}
