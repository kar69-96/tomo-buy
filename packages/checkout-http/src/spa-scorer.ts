/**
 * Multi-signal SPA detection scorer.
 *
 * Scores HTML against 10 signals to determine whether a page
 * is server-rendered (usable via HTTP) or requires JS rendering.
 *
 * Score >= 3 → server-rendered (use HTTP parser)
 * Score <  3 → needs browser rendering
 *
 * Pure function — no side effects, no network calls.
 */

import * as cheerio from "cheerio";
import {
  SPA_DETECTION_SIGNALS,
  SPA_SCORE_THRESHOLD,
} from "@bloon/core";
import type { SpaScore, SpaSignalResult } from "./types.js";

// ---- Framework marker detection ----

const FRAMEWORK_MARKERS = [
  "__NEXT_DATA__",
  "__NUXT__",
  "__remixContext",
  "data-reactroot",
  "ng-version",
  "data-server-rendered",
];

function hasFrameworkMarkers(html: string, $: cheerio.CheerioAPI): boolean {
  // Check inline script content for framework globals
  const scriptContent = $("script")
    .map((_, el) => $(el).html() ?? "")
    .get()
    .join(" ");

  for (const marker of FRAMEWORK_MARKERS) {
    if (html.includes(marker) || scriptContent.includes(marker)) {
      return true;
    }
  }

  // Check for data-reactroot attribute
  if ($("[data-reactroot]").length > 0) return true;
  if ($("[ng-version]").length > 0) return true;

  return false;
}

// ---- Empty mount point detection ----

const MOUNT_SELECTORS = ["#app", "#root", "#__next", "#__nuxt", "[data-reactroot]"];

function hasEmptyMountPoint($: cheerio.CheerioAPI): boolean {
  for (const sel of MOUNT_SELECTORS) {
    const el = $(sel);
    if (el.length > 0) {
      const childCount = el.children().length;
      const textLen = (el.text() ?? "").trim().length;
      // Empty or near-empty mount point
      if (childCount <= 1 && textLen < 50) {
        return true;
      }
    }
  }
  return false;
}

// ---- Visible text length ----

function getVisibleTextLength($: cheerio.CheerioAPI): number {
  // Remove script and style tags before measuring
  const clone = cheerio.load($.html() ?? "");
  clone("script, style, noscript").remove();
  return (clone("body").text() ?? "").replace(/\s+/g, " ").trim().length;
}

// ---- Noscript content check ----

function hasNoscriptContent($: cheerio.CheerioAPI): boolean {
  const noscript = $("noscript");
  if (noscript.length === 0) return false;
  const text = noscript.text().trim();
  // Must have meaningful content (not just "enable JavaScript")
  return text.length > 100;
}

// ---- Score HTML against all signals ----

export function scoreSpa(html: string): SpaScore {
  const $ = cheerio.load(html);
  const signals: SpaSignalResult[] = [];
  let totalScore = 0;

  const visibleTextLen = getVisibleTextLength($);

  for (const signal of SPA_DETECTION_SIGNALS) {
    let matched = false;

    if (signal.selector !== null) {
      // CSS selector-based check
      matched = $(signal.selector).length > 0;
    } else {
      // Custom logic for signals without selectors
      switch (signal.name) {
        case "framework_marker":
          matched = hasFrameworkMarkers(html, $);
          break;
        case "empty_mount":
          matched = hasEmptyMountPoint($);
          break;
        case "minimal_text":
          matched = visibleTextLen < 100;
          break;
        case "substantial_text":
          matched = visibleTextLen > 500;
          break;
        case "noscript_content":
          matched = hasNoscriptContent($);
          break;
      }
    }

    const weight = matched ? signal.weight : 0;
    totalScore += weight;

    signals.push({
      name: signal.name,
      weight,
      matched,
      description: signal.description,
    });
  }

  return {
    score: totalScore,
    isServerRendered: totalScore >= SPA_SCORE_THRESHOLD,
    signals,
  };
}
