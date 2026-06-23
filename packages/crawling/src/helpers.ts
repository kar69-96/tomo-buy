import type { ProductOption } from "@bloon/core";

export function extractPriceFromString(text: string): string | null {
  const cleaned = text.trim();
  // Try European decimal format first: "47,49", "47,49 €"
  const euroMatch = /(\d+),(\d{1,2})(?!\d)/.exec(cleaned);
  if (euroMatch) return `${euroMatch[1]}.${euroMatch[2]}`;
  // US/standard format: "98.00", "$98.00", "1,234.56"
  const stdCleaned = cleaned.replace(/,/g, "");
  const stdMatch = /\d+\.?\d*/.exec(stdCleaned);
  return stdMatch ? stdMatch[0] : null;
}

export function stripCurrencySymbol(price: string): string {
  // Extract the first price-like value, handling European comma decimals
  const extracted = extractPriceFromString(price);
  if (extracted) return extracted;
  // Fallback: strip non-numeric except dots
  return price.replace(/^[^\d]*/, "").replace(/[^\d.]/g, "") || price;
}

export function mapOptions(
  rawOptions?: Array<{
    name: string;
    values: string[];
    prices?: Record<string, string>;
  }>,
): ProductOption[] {
  return (rawOptions ?? []).map((opt) => {
    if (!opt.prices || Object.keys(opt.prices).length === 0) {
      return { name: opt.name, values: opt.values };
    }
    const mapped = Object.fromEntries(
      Object.entries(opt.prices).map(([k, v]) => [k, stripCurrencySymbol(v)]),
    );
    return { name: opt.name, values: opt.values, prices: mapped };
  });
}

export function isValidPrice(price: string): boolean {
  const num = parseFloat(stripCurrencySymbol(price));
  return Number.isFinite(num) && num > 0;
}

export function cleanExtractField(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const trimmed = v.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return undefined;
  return trimmed;
}

/**
 * Returns true if `finalUrl` looks like a different page (homepage, search,
 * different product) compared to `originalUrl`.  Used to detect redirects
 * in both Browserbase and Exa discovery paths.
 */
export function isRedirectToOtherPage(originalUrl: string, finalUrl: string | undefined): boolean {
  if (!finalUrl || originalUrl === finalUrl) return false;
  try {
    const orig = new URL(originalUrl);
    const final = new URL(finalUrl);
    if (orig.hostname !== final.hostname) return true;
    const origPath = orig.pathname.replace(/\/$/, "");
    const finalPath = final.pathname.replace(/\/$/, "");
    if (finalPath === "" || finalPath.startsWith("/search")) return true;
    if (origPath !== finalPath) {
      const origSegments = origPath.split("/").filter(Boolean);
      const finalSegments = finalPath.split("/").filter(Boolean);
      if (origSegments.length >= 2 && finalSegments.length >= 2) {
        if (origSegments[origSegments.length - 1] !== finalSegments[finalSegments.length - 1]) {
          return true;
        }
      }
      if (origSegments.length >= 2 && finalSegments.length <= 1) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Normalize a word for overlap comparison: lowercase + strip non-alphanumeric
 * (handles ™, ®, accents, etc.)
 */
function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Parse words from a single path segment.
 * Splits on hyphens/underscores/dots, filters out short words and pure numeric IDs.
 */
function wordsFromSegment(segment: string): string[] {
  return segment
    .replace(/\.[^.]+$/, "") // remove file extension (.html, .json)
    .split(/[-_.]/)
    .map((s) => normalizeWord(s))
    .filter((w) => w.length > 2 && !/^\d+$/.test(w));
}

/**
 * Extract meaningful words from URL path segments (the "slug").
 * Picks the segment with the most words — the product slug will have more
 * meaningful words than tracking/ref params (e.g. Amazon's ref=sr_1_2_sspa).
 * Returns empty array only if no segment has words.
 */
export function extractSlugWords(url: string): string[] {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    let best: string[] = [];
    for (const segment of segments) {
      const words = wordsFromSegment(segment);
      if (words.length > best.length) best = words;
    }
    return best;
  } catch {
    return [];
  }
}

/**
 * Compute the fraction of URL slug words that appear in the product name.
 * Returns 1.0 if the URL has no extractable slug words (can't validate).
 */
export function computeUrlProductOverlap(
  url: string,
  productName: string,
): number {
  const slugWords = extractSlugWords(url);
  if (slugWords.length === 0) return 1;
  const nameWords = new Set(
    productName
      .split(/\s+/)
      .map((w) => normalizeWord(w))
      .filter((w) => w.length > 2),
  );
  if (nameWords.size === 0) return 0;
  let matches = 0;
  for (const word of slugWords) {
    if (nameWords.has(word)) matches++;
  }
  return matches / slugWords.length;
}

export function computeWordOverlap(a: string, b: string): number {
  const wordsA = new Set(
    a
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  const wordsB = new Set(
    b
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }
  return overlap / Math.max(wordsA.size, wordsB.size);
}
