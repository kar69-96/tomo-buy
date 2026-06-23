/**
 * Agentcard funding source — issues single-use virtual cards via the `agentcard`
 * consumer CLI and reveals their details for checkout injection.
 *
 * SECURITY: the revealed PAN/CVV/expiry are returned as a CardInfo and flow ONLY
 * into the CDP card-fill path (fill.ts / scripted-actions.ts). They are NEVER
 * logged, never echoed, and never sent to the LLM. Only the opaque card id is
 * ever logged.
 *
 * The CLI has no --json flag, so we parse its human-readable stdout. Parsing is
 * isolated here behind defensive regexes (unit-tested in tests/agentcard.test.ts).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CardInfo } from "@tomo/core";

const execFileAsync = promisify(execFile);

const CLI_TIMEOUT_MS = 120_000;

/** Build the command + args. Prefer a global `agentcard` if AGENTCARD_BIN is set. */
function cli(args: string[]): { cmd: string; argv: string[] } {
  const bin = process.env.AGENTCARD_BIN;
  if (bin) return { cmd: bin, argv: args };
  return { cmd: "npx", argv: ["-y", "agentcard@latest", ...args] };
}

async function run(args: string[]): Promise<string> {
  const { cmd, argv } = cli(args);
  const { stdout, stderr } = await execFileAsync(cmd, argv, {
    timeout: CLI_TIMEOUT_MS,
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
  // Some CLIs print structured output to stderr; include both for parsing.
  return `${stdout}\n${stderr}`;
}

// ---- Parsers (pure, testable) ----

/** Extract a card/request id like `req_abc123` or `card_abc123` from output. */
export function parseCardId(output: string): string | null {
  const tagged = output.match(/\b(?:req|card|crd|crq)_[A-Za-z0-9]+/);
  if (tagged) return tagged[0];
  // Fallback: any prefix_token id shape.
  const generic = output.match(/\b[a-z]{2,6}_[A-Za-z0-9]{6,}\b/);
  return generic ? generic[0] : null;
}

/** Parse PAN / expiry / CVV / cardholder from `agentcard details <id>` output. */
export function parseCardDetails(output: string): CardInfo | null {
  // PAN: 13–19 digits, possibly grouped by spaces/dashes.
  const panMatch = output.match(/(?:\d[ -]?){13,19}/);
  const number = panMatch ? panMatch[0].replace(/[ -]/g, "") : "";

  // Expiry: MM/YY or MM/YYYY (also handle "MM - YYYY").
  const expMatch = output.match(/\b(0[1-9]|1[0-2])\s*[\/\-]\s*(\d{2,4})\b/);
  const expiry = expMatch ? `${expMatch[1]}/${expMatch[2]}` : "";

  // CVV: 3–4 digits near a cvv/cvc/security-code label.
  let cvv = "";
  const cvvLabeled = output.match(
    /(?:cvv|cvc|security\s*code|cvc2|cvv2)\D{0,12}(\d{3,4})\b/i,
  );
  if (cvvLabeled) {
    cvv = cvvLabeled[1]!;
  } else {
    // Fallback: a standalone 3–4 digit group that is NOT part of the PAN.
    const stripped = output.replace(panMatch ? panMatch[0] : "", "");
    const loose = stripped.match(/\b(\d{3,4})\b/);
    cvv = loose ? loose[1]! : "";
  }

  // Cardholder name (best-effort).
  const nameMatch = output.match(/(?:cardholder|name\s*on\s*card|holder)\s*[:\-]?\s*([A-Za-z][A-Za-z .'-]{1,60})/i);
  const cardholder_name = nameMatch ? nameMatch[1]!.trim() : "";

  if (!number || number.length < 13) return null;
  return { number, expiry, cvv, cardholder_name };
}

/** Parse recent 3DS / OTP codes (4–8 digits) from `agentcard 3ds` output. */
export function parse3dsCodes(output: string): string[] {
  const codes = output.match(/\b\d{4,8}\b/g) ?? [];
  // De-dup, preserve order.
  return [...new Set(codes)];
}

// ---- Public funding operations ----

export interface AgentcardPreflight {
  loggedIn: boolean;
  message?: string;
}

/** Confirm the CLI is logged in. Throws a clear message if not. */
export async function preflight(): Promise<AgentcardPreflight> {
  let out: string;
  try {
    out = await run(["whoami"]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `agentcard CLI not available or failed (${msg.slice(0, 120)}). ` +
        `Install/login: run \`agentcard signup\` then \`agentcard setup\`.`,
    );
  }
  if (/not logged in/i.test(out)) {
    throw new Error(
      "Agentcard is not logged in. Run `agentcard signup --email you@example.com` " +
        "then `agentcard setup` (this is a one-time human step the agent cannot do).",
    );
  }
  return { loggedIn: true };
}

/**
 * Issue a single-use card for the given dollar amount and return its id.
 * Amount is rounded UP to cents. The id is safe to log; details are not fetched here.
 */
export async function issueCard(amountDollars: number): Promise<string> {
  if (!(amountDollars > 0)) {
    throw new Error(`Invalid card amount: ${amountDollars}`);
  }
  const amount = (Math.ceil(amountDollars * 100) / 100).toFixed(2);
  const out = await run(["request", "new", "--amount", amount]);
  const id = parseCardId(out);
  if (!id) {
    throw new Error(
      `Could not parse a card id from \`agentcard request new --amount ${amount}\` output. ` +
        `The CLI output format may have changed.`,
    );
  }
  return id;
}

/**
 * Reveal full card details for a card id. The returned CardInfo must only be
 * passed to the CDP card-fill path — never logged or sent to the LLM.
 */
export async function revealCard(cardId: string): Promise<CardInfo> {
  const out = await run(["details", cardId]);
  const info = parseCardDetails(out);
  if (!info) {
    throw new Error(
      `Could not parse card details for ${cardId}. The CLI output format may have changed.`,
    );
  }
  return info;
}

/** Read 3DS/OTP verification codes received in the last few minutes. */
export async function read3dsCodes(): Promise<string[]> {
  try {
    const out = await run(["3ds"]);
    return parse3dsCodes(out);
  } catch {
    return [];
  }
}

/**
 * Convenience: preflight → issue → reveal. Returns the CardInfo plus the id.
 */
export async function issueAndRevealCard(
  amountDollars: number,
): Promise<{ id: string; card: CardInfo }> {
  await preflight();
  const id = await issueCard(amountDollars);
  const card = await revealCard(id);
  return { id, card };
}
