/**
 * Parse raw HTML into a PageSnapshot for downstream classification
 * and analysis.
 *
 * Uses cheerio (server-side DOM) to extract forms, hidden inputs,
 * inline configs (JSON-LD, __NEXT_DATA__, __NUXT__), Stripe
 * publishable keys, meta tags, links, buttons, and script sources.
 *
 * Pure function -- no side effects, no network calls.
 */

import * as cheerio from "cheerio";
import type { PageSnapshot, ParsedForm, FormField } from "./types.js";

// ---- Stripe key pattern ----

const STRIPE_KEY_PATTERN = /pk_(?:live|test)_[A-Za-z0-9]+/g;

// ---- Helper: cheerio selection type alias ----

/** Cheerio selection returned by $("selector") or $(element). */
type Selection = ReturnType<cheerio.CheerioAPI>;

// ---- Helper: build a stable CSS selector path for an element ----

function buildSelectorPath(
  $el: Selection,
  tagName: string,
): string {
  const tag = tagName.toLowerCase();
  const id = $el.attr("id");
  if (id) return `${tag}#${id}`;

  const cls = $el.attr("class")?.trim();
  if (cls) {
    const first = cls.split(/\s+/)[0];
    return `${tag}.${first}`;
  }

  // Fall back to tag + nth-of-type among siblings
  const parent = $el.parent();
  if (parent.length > 0) {
    const siblings = parent.children(tag);
    const idx = siblings.index($el);
    if (siblings.length > 1) {
      return `${tag}:nth-of-type(${idx + 1})`;
    }
  }

  return tag;
}

// ---- Helper: extract visible text length ----

function computeVisibleTextLength(html: string): number {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  return ($("body").text() ?? "").replace(/\s+/g, " ").trim().length;
}

// ---- Helper: parse a single form element ----

function parseForm(
  $: cheerio.CheerioAPI,
  $form: Selection,
): ParsedForm {
  const action = $form.attr("action") ?? "";
  const method = ($form.attr("method") ?? "GET").toUpperCase();

  const fields: FormField[] = [];
  const hiddenInputs: Record<string, string> = {};

  // Process inputs, selects, and textareas
  $form.find("input, select, textarea").each((_, el) => {
    const $el = $(el);
    const tagName = ("tagName" in el ? (el as { tagName: string }).tagName : "input").toLowerCase();
    const name = $el.attr("name") ?? "";
    const type = ($el.attr("type") ?? (tagName === "select" ? "select" : "text")).toLowerCase();
    const value = $el.attr("value");
    const placeholder = $el.attr("placeholder");
    const autocomplete = $el.attr("autocomplete");
    const required = $el.attr("required") !== undefined;

    if (type === "hidden" && name) {
      hiddenInputs[name] = value ?? "";
    }

    if (name) {
      const field: FormField = {
        name,
        type,
        ...(value !== undefined ? { value } : {}),
        ...(required ? { required } : {}),
        ...(placeholder ? { placeholder } : {}),
        ...(autocomplete ? { autocomplete } : {}),
      };
      fields.push(field);
    }
  });

  return { action, method, fields, hiddenInputs };
}

// ---- Helper: safely parse JSON ----

function safeParseJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// ---- Main parser ----

/**
 * Parse HTML into a structured PageSnapshot.
 *
 * @param html - Raw HTML string from HTTP response or browser renderer
 * @param url  - The URL the HTML was fetched from (used for metadata)
 * @returns Immutable PageSnapshot with all extracted data
 */
export function parseHTML(html: string, url: string): PageSnapshot {
  const $ = cheerio.load(html);

  // ---- Title ----
  const title = $("title").first().text().trim();

  // ---- Forms ----
  const forms: ParsedForm[] = [];
  $("form").each((_, el) => {
    forms.push(parseForm($, $(el)));
  });

  // ---- All hidden inputs (including outside forms) ----
  const hiddenInputs: Record<string, string> = {};
  $('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr("name");
    const value = $(el).attr("value") ?? "";
    if (name) {
      hiddenInputs[name] = value;
    }
  });

  // ---- Inline configs ----
  const inlineConfigs: Record<string, unknown>[] = [];
  const jsonLd: Record<string, unknown>[] = [];

  // JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (raw) {
      const parsed = safeParseJson(raw);
      if (parsed) {
        jsonLd.push(parsed);
        inlineConfigs.push(parsed);
      }
    }
  });

  // __NEXT_DATA__
  $("script#__NEXT_DATA__").each((_, el) => {
    const raw = $(el).html();
    if (raw) {
      const parsed = safeParseJson(raw);
      if (parsed) {
        inlineConfigs.push(parsed);
      }
    }
  });

  // __NUXT__ -- extract from inline scripts
  $("script:not([src])").each((_, el) => {
    const raw = $(el).html() ?? "";
    if (raw.includes("window.__NUXT__")) {
      // Best-effort: try to extract JSON-like assignment
      const match = raw.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*(?:<\/|$)/);
      if (match?.[1]) {
        const parsed = safeParseJson(match[1]);
        if (parsed) {
          inlineConfigs.push(parsed);
        }
      }
    }
  });

  // ---- Stripe publishable keys ----
  const stripeKeySet = new Set<string>();
  $("script").each((_, el) => {
    const content = $(el).html() ?? "";
    const src = $(el).attr("src") ?? "";
    const combined = content + " " + src;
    const matches = combined.match(STRIPE_KEY_PATTERN);
    if (matches) {
      for (const key of matches) {
        stripeKeySet.add(key);
      }
    }
  });
  const stripeKeys = [...stripeKeySet];

  // ---- Meta tags ----
  const metaTags: Record<string, string> = {};
  $("meta").each((_, el) => {
    const name = $(el).attr("name") ?? $(el).attr("property") ?? "";
    const content = $(el).attr("content") ?? "";
    if (name && content) {
      metaTags[name] = content;
    }
  });

  // ---- Links ----
  const links: Array<{ href: string; text: string }> = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const text = $(el).text().trim();
    if (href) {
      links.push({ href, text });
    }
  });

  // ---- Buttons ----
  const buttons: Array<{ text: string; type?: string; selector: string }> = [];
  $('button, input[type="submit"], [role="button"]').each((_, el) => {
    const $el = $(el);
    const tagName = ("tagName" in el ? (el as { tagName: string }).tagName : "unknown").toLowerCase();
    const text =
      tagName === "input"
        ? ($el.attr("value") ?? "")
        : $el.text().trim();
    const type = $el.attr("type") ?? undefined;
    const selector = buildSelectorPath($el, tagName);
    buttons.push({ text, ...(type ? { type } : {}), selector });
  });

  // ---- Script sources ----
  const scriptSrcs: string[] = [];
  $("script[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src) {
      scriptSrcs.push(src);
    }
  });

  // ---- Visible text length ----
  const visibleTextLength = computeVisibleTextLength(html);

  return {
    url,
    title,
    forms,
    hiddenInputs,
    inlineConfigs,
    stripeKeys,
    jsonLd,
    metaTags,
    links,
    buttons,
    scriptSrcs,
    visibleTextLength,
  };
}
