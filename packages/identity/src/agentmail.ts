/**
 * AgentMail wrapper for agent identities (inbox provisioning + OTP polling).
 *
 * Mirrors packages/checkout/src/agentmail.ts but lives in @tomo/identity so the
 * dependency points checkout -> identity (never the reverse). When
 * AGENTMAIL_API_KEY is unset, provisioning falls back to a local placeholder
 * address so agent identities can still be created offline/in tests.
 */
import { AgentMailClient } from "agentmail";

let client: AgentMailClient | null = null;

function getClient(): AgentMailClient | null {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new AgentMailClient({ apiKey });
  return client;
}

function inboxIdToEmail(id: string): string {
  return id.includes("@") ? id : `${id}@agentmail.to`;
}

export interface AgentInbox {
  inboxId: string | null;
  email: string;
}

/**
 * Create or reuse an AgentMail inbox. Reuses the first existing inbox to avoid
 * free-tier limits. Returns a local placeholder when AgentMail is unconfigured.
 */
export async function provisionInbox(localId: string): Promise<AgentInbox> {
  const am = getClient();
  if (!am) {
    return { inboxId: null, email: `agent+${localId}@tomo.local` };
  }

  try {
    const existing = await am.inboxes.list();
    const inboxes = existing.inboxes ?? [];
    if (inboxes.length > 0) {
      const reuse = inboxes[0]!;
      return { inboxId: reuse.inboxId, email: inboxIdToEmail(reuse.inboxId) };
    }
  } catch {
    // fall through to create
  }

  const inbox = await am.inboxes.create();
  return { inboxId: inbox.inboxId, email: inboxIdToEmail(inbox.inboxId) };
}

// A code token: digit-led, 4–8 digits, with optional inner spaces/hyphens a sender
// may insert ("482 913", "482-913"). Digit-led so a label connector word ("is")
// can't be captured. Normalized (separators stripped) and length-checked below.
const CODE_TOKEN = "([0-9](?:[0-9\\s-]{2,9})?[0-9])";

// Labeled patterns win over a bare number so a surrounding order id / year / total
// isn't mistaken for the code. An optional "is" connector follows the label.
const CODE_PATTERNS = [
  new RegExp(`(?:verification|security|access)\\s*code(?:\\s+is)?[:\\s#]*${CODE_TOKEN}`, "i"),
  new RegExp(`\\b(?:one[-\\s]?time(?:\\s+(?:code|passcode|password))?|otp|passcode|pin)\\b(?:\\s+is)?[:\\s#]*${CODE_TOKEN}`, "i"),
  new RegExp(`\\bcode(?:\\s+is)?[:\\s#]+${CODE_TOKEN}`, "i"),
  // Bare fallback: a standalone 4–8 digit run.
  /\b(\d{4,8})\b/,
];

/** Strip the spaces/hyphens a sender may put inside a code ("482 913" → "482913"). */
function normalizeCode(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

export function extractCode(text: string): string | null {
  for (const pattern of CODE_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const code = normalizeCode(match[1]);
      if (/^\d{4,8}$/.test(code)) return code;
    }
  }
  return null;
}

/** Poll an AgentMail inbox for a verification code arriving after a timestamp. */
export async function pollInboxForCode(
  inboxId: string,
  sinceTimestamp: string,
  timeoutMs = 60_000,
  pollIntervalMs = 4_000,
): Promise<string | null> {
  const am = getClient();
  if (!am) return null;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await am.inboxes.messages.list(inboxId, {
        after: new Date(sinceTimestamp),
        limit: 10,
      });
      for (const msg of response.messages ?? []) {
        const full = await am.inboxes.messages.get(inboxId, msg.messageId);
        const body = full.extractedText ?? full.text ?? "";
        const code = extractCode(body);
        if (code) return code;
      }
    } catch {
      // transient; keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return null;
}

export function resetAgentMail(): void {
  client = null;
}
