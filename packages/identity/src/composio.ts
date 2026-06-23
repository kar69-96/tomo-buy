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

function extractMessages(data: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [data.messages, data.emails, data.data, data.items];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as Record<string, unknown>[];
  }
  return [];
}

// ---- Real client ----

// Composio rejects manual execution without a toolkit version. Passing
// "latest" is not accepted by the execute endpoint, so we skip the version
// pin (acceptable here: we always want the current Gmail tool behavior).
const SKIP_VERSION = { dangerouslySkipVersionCheck: true } as const;

export class ComposioGmailClient implements ComposioClient {
  private composio: Composio;
  private userId: string;
  private checked = false;
  private connected = false;
  private connectedAccountId: string | undefined;

  constructor(apiKey: string, userId = "default") {
    this.composio = new Composio({ apiKey });
    this.userId = userId;
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
        const uid = str(first.userId ?? first.user_id);
        if (uid) this.userId = uid;
      }
    } catch {
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
    } catch {
      return [];
    }
  }

  async searchEmail(params: EmailSearchParams): Promise<EmailHit[]> {
    if (!(await this.isConnected())) return [];
    try {
      const res = await this.composio.tools.execute("GMAIL_FETCH_EMAILS", {
        userId: this.userId,
        ...SKIP_VERSION,
        ...(this.connectedAccountId ? { connectedAccountId: this.connectedAccountId } : {}),
        arguments: {
          query: buildGmailQuery(params),
          max_results: params.limit ?? 10,
          include_payload: false,
        },
      } as never);
      if (!(res as { successful?: boolean }).successful) return [];
      const data = ((res as { data?: Record<string, unknown> }).data ?? {}) as Record<string, unknown>;
      return extractMessages(data).map(mapHit);
    } catch {
      return [];
    }
  }

  async getMessage(id: string): Promise<EmailMessage | null> {
    if (!id) return null;
    try {
      const res = await this.composio.tools.execute("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", {
        userId: this.userId,
        ...SKIP_VERSION,
        ...(this.connectedAccountId ? { connectedAccountId: this.connectedAccountId } : {}),
        arguments: { message_id: id, user_id: "me", format: "full" },
      } as never);
      if (!(res as { successful?: boolean }).successful) return null;
      const data = ((res as { data?: Record<string, unknown> }).data ?? {}) as Record<string, unknown>;
      const m = (extractMessages(data)[0] ?? data) as Record<string, unknown>;
      return {
        id: str(m.messageId ?? m.id ?? id),
        from: str(m.sender ?? m.from),
        subject: str(m.subject),
        body: str(m.messageText ?? m.body ?? m.snippet),
      };
    } catch {
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
