/**
 * Extract dynamic values from HTTP responses using ValueSource rules.
 *
 * Handles all 6 ValueSourceType variants:
 *   - json_path:        Dot-notation path into parsed JSON (supports array indexing)
 *   - css_selector:     Cheerio CSS selector with optional attribute
 *   - regex:            Regex with capture group against response body
 *   - set_cookie:       Cookie name lookup in Set-Cookie headers
 *   - response_header:  Case-insensitive header lookup
 *   - url_segment:      Regex with capture group against the final URL
 *
 * All functions are pure and never throw. Returns string | null.
 */

import * as cheerio from "cheerio";
import type { ValueSource } from "@bloon/core";
import type { FetchResult } from "./types.js";

// ---- JSON path traversal ----

/**
 * Navigate a dot-notation path through a JSON value.
 * Supports simple array indexing: "items[0].id", "checkout.token".
 *
 * @param obj  - The parsed JSON value to traverse
 * @param path - Dot-separated path with optional bracket notation
 * @returns The resolved value as a string, or null if not found
 */
function resolveJsonPath(obj: unknown, jsonPath: string): string | null {
  // Tokenize: "items[0].name" -> ["items", "0", "name"]
  const segments: string[] = [];
  for (const part of jsonPath.split(".")) {
    // Handle bracket notation: "items[0]" -> ["items", "0"]
    const bracketMatch = part.match(/^([^[]*)\[(\d+)\]$/);
    if (bracketMatch) {
      if (bracketMatch[1]) segments.push(bracketMatch[1]);
      segments.push(bracketMatch[2]!);
    } else if (part) {
      segments.push(part);
    }
  }

  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) return null;

    if (Array.isArray(current)) {
      const index = parseInt(segment, 10);
      if (isNaN(index) || index < 0 || index >= current.length) return null;
      current = current[index];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return null;
    }
  }

  if (current === null || current === undefined) return null;
  if (typeof current === "string") return current;
  if (typeof current === "number" || typeof current === "boolean") return String(current);

  // For objects/arrays, return JSON stringified
  return JSON.stringify(current);
}

// ---- CSS selector extraction ----

/**
 * Find an element by CSS selector and return attribute value or text content.
 */
function extractByCssSelector(
  html: string,
  selector: string,
  attribute?: string,
): string | null {
  try {
    const $ = cheerio.load(html);
    const el = $(selector).first();
    if (el.length === 0) return null;

    if (attribute) {
      const val = el.attr(attribute);
      return val !== undefined ? val : null;
    }

    const text = el.text().trim();
    return text || null;
  } catch {
    return null;
  }
}

// ---- Regex extraction ----

/**
 * Apply a regex to text and return the specified capture group.
 */
function extractByRegex(
  text: string,
  pattern: string,
  group: number,
): string | null {
  try {
    const regex = new RegExp(pattern);
    const match = regex.exec(text);
    if (!match) return null;

    const value = match[group];
    return value !== undefined ? value : null;
  } catch {
    return null;
  }
}

// ---- Set-Cookie extraction ----

/**
 * Find a cookie by name in Set-Cookie header strings.
 * Parses "name=value; ..." format.
 */
function extractFromSetCookie(
  setCookies: readonly string[],
  cookieName: string,
): string | null {
  for (const header of setCookies) {
    const nameValue = header.split(";")[0];
    if (!nameValue) continue;

    const eqIdx = nameValue.indexOf("=");
    if (eqIdx === -1) continue;

    const name = nameValue.slice(0, eqIdx).trim();
    if (name === cookieName) {
      return nameValue.slice(eqIdx + 1).trim();
    }
  }
  return null;
}

// ---- Response header extraction (case-insensitive) ----

/**
 * Look up a header value by name (case-insensitive).
 */
function extractFromHeader(
  headers: Readonly<Record<string, string>>,
  headerName: string,
): string | null {
  const lower = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }
  return null;
}

// ---- Main extractor ----

/**
 * Extract a dynamic value from an HTTP response using a ValueSource rule.
 *
 * @param source      - Describes how to extract the value (type, path, attribute, group)
 * @param fetchResult - The HTTP response to extract from
 * @returns The extracted string value, or null if extraction fails
 */
export function extractValue(
  source: ValueSource,
  fetchResult: FetchResult,
): string | null {
  switch (source.type) {
    case "json_path": {
      try {
        // Strip leading "$." if present (JSONPath convention)
        const cleanPath = source.path.startsWith("$.")
          ? source.path.slice(2)
          : source.path;
        const parsed: unknown = JSON.parse(fetchResult.body);
        return resolveJsonPath(parsed, cleanPath);
      } catch {
        return null;
      }
    }

    case "css_selector": {
      return extractByCssSelector(
        fetchResult.body,
        source.path,
        source.attribute,
      );
    }

    case "regex": {
      const group = source.group ?? 1;
      return extractByRegex(fetchResult.body, source.path, group);
    }

    case "set_cookie": {
      return extractFromSetCookie(fetchResult.setCookies, source.path);
    }

    case "response_header": {
      return extractFromHeader(fetchResult.headers, source.path);
    }

    case "url_segment": {
      const group = source.group ?? 1;
      return extractByRegex(fetchResult.finalUrl, source.path, group);
    }

    default: {
      return null;
    }
  }
}
