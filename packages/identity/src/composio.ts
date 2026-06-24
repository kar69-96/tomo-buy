/**
 * Composio client — reads the user's connected Gmail.
 *
 * Two implementations behind one interface:
 *   - ComposioGmailClient: real, backed by @composio/core (v3 `ak_` keys).
 *   - StubComposioClient: returns nothing / disconnected (used when no key is set
 *     or in tests), which makes the resolver default to an agent identity.
 *
 * Used for (1) deciding whether the user already has an account on a service
 * (search their inbox for signup confirmations / receipts) and (2) reading
 * one-time passcodes sent to the user's email.
 */
import { Composio } from "@composio/core";
import { getComposioKey } from "@tomo/core";

export interface ComposioConnection {
  provider: "gmail";
  email: string;
  status: "connected";
}

export interface EmailSearchParams {
  query?: string;
  from?: string;
  newerThanDays?: number;
  limit?: number;
}

export interface EmailHit {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  received_at: string;
}

export interface EmailMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
}

export interface ComposioClient {
  /** Whether a usable connected Gmail account exists (cached after first check). */
  isConnected(): Promise<boolean>;
  listConnections(): Promise<ComposioConnection[]>;
  searchEmail(params: EmailSearchParams): Promise<EmailHit[]>;
  getMessage(id: string): Promise<EmailMessage | null>;
  /** The connected mailbox's own address (for filling the login form). Null if unknown. */
  getProfileEmail(): Promise<string | null>;
}

// ---- Gmail query building + response mapping (pure, testable) ----

export function buildGmailQuery(params: EmailSearchParams): string {
  const parts: string[] = [];
  if (params.from) parts.push(`from:${params.from}`);
  if (params.newerThanDays) parts.push(`newer_than:${params.newerThanDays}d`);
  if (params.query) parts.push(`(${params.query})`);
  return parts.join(" ").trim();
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Map one raw Gmail message record (open shape) into an EmailHit. */
export function mapHit(m: Record<string, unknown>): EmailHit {
  const internalDate = m.internalDate ?? m.messageTimestamp;
  let received = "";
  const n = Number(internalDate);
  if (Number.isFinite(n) && n > 0) received = new Date(n).toISOString();
  else if (typeof internalDate === "string") received = internalDate;
  return {
    id: str(m.messageId ?? m.id ?? m.threadId),
    from: str(m.sender ?? m.from),
    subject: str(m.subject),
    snippet: str(m.snippet ?? m.preview),
    received_at: received,
  };
}

/**
 * Find the message array in a GMAIL_FETCH_EMAILS response. The exact envelope
 * key varies across Composio toolkit versions, so we check the known aliases and
 * unwrap one level of nesting (e.g. `data.response_data.messages`). Generic over
 * the shape — never keyed on a sender or subject. Exported for shape tests.
 */
export function extractMessages(data: Record<string, unknown>): Record<string, unknown>[] {
  const keys = ["messages", "emails", "data", "items", "results", "threads"];
  for (const k of keys) {
    if (Array.isArray(data[k])) return data[k] as Record<string, unknown>[];
  }
  // Unwrap one level: some responses nest the list under a wrapper object whose
  // key we may not know (e.g. response_data.messages). Recurse into any object
  // value, one level deep, to find the list.
  for (const v of Object.values(data)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = extractMessages(v as Record<string, unknown>);
      if (nested.length) return nested;
    }
  }
  return [];
}

// ---- Real client ----

// Composio rejects manual execution without a toolkit version. Passing
// "latest" is not accepted by the execute endpoint, so we skip the version
// pin (acceptable here: we always want the current Gmail tool behavior).
const SKIP_VERSION = { dangerouslySkipVersionCheck: true } as const;

// Composio's tools.execute needs the entity (userId) that OWNS the connected
// account. The SDK's connectedAccounts list/get strip `user_id` from the parsed
// object, so we read it from the raw REST representation. Base URL is overridable
// for self-hosted backends.
const COMPOSIO_BASE_URL = process.env.COMPOSIO_BASE_URL || "https://backend.composio.dev";

export class ComposioGmailClient implements ComposioClient {
  private composio: Composio;
  private apiKey: string;
  private userId: string;
  private checked = false;
  private connected = false;
  private connectedAccountId: string | undefined;
  /** Whether userId was resolved to the real owning entity (not the "default" seed). */
  private userIdResolved = false;

  private warned = false;

  constructor(apiKey: string, userId = "default") {
    this.composio = new Composio({ apiKey });
    this.apiKey = apiKey;
    this.userId = userId;
  }

  /**
   * Find the entity (user_id) that owns a connected account. The SDK doesn't
   * expose it, so we hit the REST endpoint directly. Generic — works for any
   * entity id Composio assigned at connect time (never hardcoded).
   */
  private async resolveEntityUserId(accountId: string): Promise<string | undefined> {
    try {
      const res = await fetch(`${COMPOSIO_BASE_URL}/api/v3/connected_accounts/${accountId}`, {
        headers: { "x-api-key": this.apiKey },
      });
      if (!res.ok) return undefined;
      const j = (await res.json()) as Record<string, unknown>;
      return str(j.user_id ?? j.userId) || undefined;
    } catch (err) {
      this.warn("resolve entity user_id", err);
      return undefined;
    }
  }

  /**
   * Surface a Composio failure ONCE. A key is configured (this client only
   * exists when one is), so an error here is a real wiring problem, not the
   * benign "not connected" case — make it observable instead of silently
   * degrading to an agent identity. Logs only the error message (an API/network
   * error), never email content or codes.
   */
  private warn(context: string, err: unknown): void {
    if (this.warned) return;
    this.warned = true;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[composio] ${context} failed: ${msg.slice(0, 200)}`);
  }

  async isConnected(): Promise<boolean> {
    if (this.checked) return this.connected;
    this.checked = true;
    try {
      const res = await this.composio.connectedAccounts.list({
        toolkitSlugs: ["GMAIL"],
        statuses: ["ACTIVE"],
      } as never);
      const items = ((res as { items?: unknown[] }).items ?? []) as Record<string, unknown>[];
      const first = items[0];
      if (first) {
        this.connected = true;
        this.connectedAccountId = str(first.id) || undefined;
        // Prefer a user id the SDK exposes; otherwise resolve the owning entity
        // from REST (the SDK strips user_id from the parsed account).
        const uid = str(first.userId ?? first.user_id);
        if (uid) {
          this.userId = uid;
          this.userIdResolved = true;
        } else if (this.connectedAccountId) {
          const resolved = await this.resolveEntityUserId(this.connectedAccountId);
          if (resolved) {
            this.userId = resolved;
            this.userIdResolved = true;
          }
        }
      }
    } catch (err) {
      this.warn("connectedAccounts.list", err);
      this.connected = false;
    }
    return this.connected;
  }

  async listConnections(): Promise<ComposioConnection[]> {
    try {
      const res = await this.composio.connectedAccounts.list({
        toolkitSlugs: ["GMAIL"],
        statuses: ["ACTIVE"],
      } as never);
      const items = ((res as { items?: unknown[] }).items ?? []) as Record<string, unknown>[];
      return items.map((it) => ({
        provider: "gmail" as const,
        email: str((it.data as Record<string, unknown>)?.email ?? it.userId ?? it.user_id),
        status: "connected" as const,
      }));
    } catch (err) {
      this.warn("connectedAccounts.list", err);
      return [];
    }
  }

  async searchEmail(params: EmailSearchParams): Promise<EmailHit[]> {
    if (!(await this.isConnected())) return [];
    try {
      // Pass the owning entity's userId and let Composio auto-resolve the
      // connection. We deliberately do NOT pass connectedAccountId: pairing it
      // with a userId triggers an entity-mismatch error, and auto-resolve picks
      // the right Gmail connection for this entity.
      const res = await this.composio.tools.execute("GMAIL_FETCH_EMAILS", {
        userId: this.userId,
        ...SKIP_VERSION,
        arguments: {
          query: buildGmailQuery(params),
          max_results: params.limit ?? 10,
        },
      } as never);
      if (!(res as { successful?: boolean }).successful) return [];
      const data = ((res as { data?: Record<string, unknown> }).data ?? {}) as Record<string, unknown>;
      return extractMessages(data).map(mapHit);
    } catch (err) {
      this.warn("GMAIL_FETCH_EMAILS", err);
      return [];
    }
  }

  async getProfileEmail(): Promise<string | null> {
    if (!(await this.isConnected())) return null;
    try {
      const res = await this.composio.tools.execute("GMAIL_GET_PROFILE", {
        userId: this.userId,
        ...SKIP_VERSION,
        arguments: { user_id: "me" },
      } as never);
      if (!(res as { successful?: boolean }).successful) return null;
      const data = ((res as { data?: Record<string, unknown> }).data ?? {}) as Record<string, unknown>;
      return str(data.emailAddress ?? data.email) || null;
    } catch (err) {
      this.warn("GMAIL_GET_PROFILE", err);
      return null;
    }
  }

  async getMessage(id: string): Promise<EmailMessage | null> {
    if (!id) return null;
    try {
      const res = await this.composio.tools.execute("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", {
        userId: this.userId,
        ...SKIP_VERSION,
        arguments: { message_id: id, user_id: "me", format: "full" },
      } as never);
      if (!(res as { successful?: boolean }).successful) return null;
      const data = ((res as { data?: Record<string, unknown> }).data ?? {}) as Record<string, unknown>;
      const m = (extractMessages(data)[0] ?? data) as Record<string, unknown>;
      return {
        id: str(m.messageId ?? m.id ?? id),
        from: str(m.sender ?? m.from),
        subject: str(m.subject),
        // The plain-text body field name varies by toolkit version; check the
        // known aliases so extractCode has the fullest text to scan.
        body: str(
          m.messageText ?? m.text ?? m.plainText ?? m.body ?? m.messageBody ?? m.snippet ?? m.preview,
        ),
      };
    } catch (err) {
      this.warn("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", err);
      return null;
    }
  }
}

// ---- Stub client ----

export class StubComposioClient implements ComposioClient {
  async isConnected(): Promise<boolean> {
    return false;
  }
  async listConnections(): Promise<ComposioConnection[]> {
    return [];
  }
  async searchEmail(_params: EmailSearchParams): Promise<EmailHit[]> {
    return [];
  }
  async getMessage(_id: string): Promise<EmailMessage | null> {
    return null;
  }
  async getProfileEmail(): Promise<string | null> {
    return null;
  }
}

let client: ComposioClient | null = null;

/** Get the process-wide Composio client (real when COMPOSIO_API_KEY is set). */
export function getComposioClient(): ComposioClient {
  if (!client) {
    const key = getComposioKey();
    client = key ? new ComposioGmailClient(key) : new StubComposioClient();
  }
  return client;
}

/** Override the client (used by tests to inject a fake). */
export function setComposioClient(override: ComposioClient | null): void {
  client = override;
}
