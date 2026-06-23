/**
 * AgentMail integration for checkout email verification.
 *
 * Provides a singleton inbox so checkout flows can receive
 * verification codes sent to the agent's email address.
 */
import { AgentMailClient } from "agentmail";

// ---- Singleton state ----

let client: AgentMailClient | null = null;
let cachedInboxId: string | null = null;
let cachedEmail: string | null = null;

// ---- Initialization ----

function getClient(): AgentMailClient {
  if (!client) {
    const apiKey = process.env.AGENTMAIL_API_KEY;
    if (!apiKey) {
      throw new Error("AGENTMAIL_API_KEY is required for email verification");
    }
    client = new AgentMailClient({ apiKey });
  }
  return client;
}

function inboxIdToEmail(id: string): string {
  return id.includes("@") ? id : `${id}@agentmail.to`;
}

/**
 * Get an existing inbox or create one. Reuses the first existing inbox
 * to avoid hitting free-tier inbox limits. Caches in memory for the
 * process lifetime.
 */
export async function getOrCreateInbox(): Promise<{
  inboxId: string;
  email: string;
}> {
  if (cachedInboxId && cachedEmail) {
    return { inboxId: cachedInboxId, email: cachedEmail };
  }

  const am = getClient();

  // Try to reuse an existing inbox first (avoids free-tier inbox limit)
  try {
    const existing = await am.inboxes.list();
    const inboxes = existing.inboxes ?? [];
    if (inboxes.length > 0) {
      const reuse = inboxes[0]!;
      cachedInboxId = reuse.inboxId;
      cachedEmail = inboxIdToEmail(reuse.inboxId);
      console.log(`  [agentmail] reusing inbox: ${cachedEmail}`);
      return { inboxId: cachedInboxId, email: cachedEmail };
    }
  } catch {
    // List failed — fall through to create
  }

  const inbox = await am.inboxes.create();
  cachedInboxId = inbox.inboxId;
  cachedEmail = inboxIdToEmail(inbox.inboxId);

  console.log(`  [agentmail] created inbox: ${cachedEmail}`);
  return { inboxId: cachedInboxId!, email: cachedEmail! };
}

/**
 * Return the cached agent email address, or null if not yet initialized.
 */
export function getAgentEmail(): string | null {
  return cachedEmail;
}

// ---- Verification code extraction ----

const CODE_PATTERNS = [
  /verification code[:\s]*(\w{4,8})/i,
  /\bcode[:\s]+(\w{4,8})\b/i,
  /\b(?:one-time|otp|passcode)[:\s]*(\w{4,8})\b/i,
  /\b(\d{4,8})\b/, // numeric codes (4-8 digits) — broadest, check last
];

function extractCode(text: string): string | null {
  for (const pattern of CODE_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Poll the inbox for a verification code arriving after `sinceTimestamp`.
 *
 * @param inboxId - Inbox to poll
 * @param sinceTimestamp - ISO 8601 timestamp; only messages after this are considered
 * @param timeoutMs - Max time to wait (default 60s)
 * @param pollIntervalMs - Interval between polls (default 4s)
 * @returns The extracted code, or null on timeout
 */
export async function pollForVerificationCode(
  inboxId: string,
  sinceTimestamp: string,
  timeoutMs = 60_000,
  pollIntervalMs = 4_000,
): Promise<string | null> {
  const am = getClient();
  const deadline = Date.now() + timeoutMs;

  console.log(
    `  [agentmail] polling for verification code (timeout=${timeoutMs}ms)`,
  );

  while (Date.now() < deadline) {
    try {
      const response = await am.inboxes.messages.list(inboxId, {
        after: new Date(sinceTimestamp),
        limit: 10,
      });

      for (const msg of response.messages ?? []) {
        // Fetch full message to get text body
        const full = await am.inboxes.messages.get(inboxId, msg.messageId);

        // Try extracted_text first (reply-only content), then full text body
        const body = full.extractedText ?? full.text ?? "";
        const code = extractCode(body);
        if (code) {
          console.log(`  [agentmail] found code: ${code}`);
          return code;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [agentmail] poll error: ${msg.slice(0, 100)}`);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  console.log(`  [agentmail] timed out waiting for verification code`);
  return null;
}

// ---- Reset (for testing) ----

export function resetAgentMail(): void {
  client = null;
  cachedInboxId = null;
  cachedEmail = null;
}
