import { FundingError } from '@tomo/core';

/**
 * Thin HTTP client for the documented Agentcard Organizations REST API
 * (see plans/technical/03-agentcard-client.md). It owns transport + error
 * mapping only — business rules (cents guard, response→CardRef mapping) live in
 * AgentcardRail. Units are CENTS everywhere.
 *
 * SECRET-FLOW: `cardDetails` returns PAN/CVV. That response flows ONLY into the
 * Executor's page-fill path. This client never logs request/response bodies.
 */

export const AGENTCARD_BASE_URL = 'https://api.agentcard.sh';

/** Minimal fetch surface, injectable so tests never touch the network. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface AgentcardClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

// --- Documented response shapes (only the fields we consume) ---

export interface CardholderResponse {
  id: string;
  [k: string]: unknown;
}

export interface PaymentMethodSetupResponse {
  checkoutUrl: string;
  stripeSessionId: string;
}

export interface PaymentMethodStatusResponse {
  hasPaymentMethod: boolean;
  paymentMethodId?: string;
}

export interface CardResponse {
  id: string;
  last4: string;
  expiry: string;
  spendLimitCents: number;
  balanceCents: number;
  status: 'OPEN' | 'IN_USE' | 'CLOSED' | 'PAUSED';
}

export interface CardDetailsResponse {
  pan: string;
  cvv: string;
  expiry: string;
  last4: string;
  status?: string;
}

export interface CloseCardResponse {
  id: string;
  status: 'CLOSED';
}

export interface ListCardsResponse {
  cards: CardResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface WebhookEndpointResponse {
  whsec: string;
  [k: string]: unknown;
}

export interface CreateCardholderInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phoneNumber: string;
  email: string;
}

/** Thin REST client. One private `request()` maps every non-2xx to a typed FundingError. */
export class AgentcardClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(opts: AgentcardClientOptions) {
    if (!opts.apiKey) {
      throw new FundingError('AgentcardClient: apiKey is required.');
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? AGENTCARD_BASE_URL;
    this.fetchFn = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  async createCardholder(input: CreateCardholderInput): Promise<CardholderResponse> {
    return this.request<CardholderResponse>('POST', '/api/v1/cardholders', input);
  }

  async setupPaymentMethod(cardholderId: string): Promise<PaymentMethodSetupResponse> {
    return this.request<PaymentMethodSetupResponse>(
      'POST',
      `/api/v1/cardholders/${encodeURIComponent(cardholderId)}/payment-method/setup`,
    );
  }

  async paymentMethodStatus(cardholderId: string): Promise<PaymentMethodStatusResponse> {
    return this.request<PaymentMethodStatusResponse>(
      'GET',
      `/api/v1/cardholders/${encodeURIComponent(cardholderId)}/payment-method/status`,
    );
  }

  async createCard(input: { amountCents: number; cardholderId: string }): Promise<CardResponse> {
    return this.request<CardResponse>('POST', '/api/v1/cards', input);
  }

  async cardDetails(cardId: string): Promise<CardDetailsResponse> {
    return this.request<CardDetailsResponse>(
      'GET',
      `/api/v1/cards/${encodeURIComponent(cardId)}/details`,
    );
  }

  async closeCard(cardId: string): Promise<CloseCardResponse> {
    return this.request<CloseCardResponse>(
      'DELETE',
      `/api/v1/cards/${encodeURIComponent(cardId)}`,
    );
  }

  async listCards(query: {
    status?: string;
    cardholderId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<ListCardsResponse> {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.cardholderId) params.set('cardholderId', query.cardholderId);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.offset !== undefined) params.set('offset', String(query.offset));
    const qs = params.toString();
    return this.request<ListCardsResponse>('GET', `/api/v1/cards${qs ? `?${qs}` : ''}`);
  }

  async createWebhookEndpoint(input: {
    url: string;
    enabled_events: string[];
  }): Promise<WebhookEndpointResponse> {
    return this.request<WebhookEndpointResponse>('POST', '/api/v1/webhook_endpoints', input);
  }

  /**
   * Core transport. Sends JSON, parses JSON, and converts any non-2xx into a
   * typed FundingError carrying `status` and the parsed body (incl. `setupUrl`
   * on 422). Never logs the request/response body (PAN/CVV could be present).
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw new FundingError(`Agentcard request failed: ${method} ${path}`, { cause });
    }

    const raw = await res.text();
    const parsed = raw ? safeJson(raw) : undefined;

    if (!res.ok) {
      throw toFundingError(res.status, method, path, parsed);
    }

    return (parsed ?? {}) as T;
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** A FundingError carrying the HTTP status and any documented extra fields. */
export interface AgentcardErrorMeta {
  status: number;
  /** Present on 422 (no payment method) per the docs. */
  setupUrl?: string;
  body?: unknown;
}

export class AgentcardError extends FundingError {
  readonly meta: AgentcardErrorMeta;
  constructor(message: string, meta: AgentcardErrorMeta) {
    super(message);
    this.meta = meta;
  }
}

function toFundingError(
  status: number,
  method: string,
  path: string,
  body: unknown,
): AgentcardError {
  const b = (body ?? {}) as Record<string, unknown>;
  const setupUrl = typeof b.setupUrl === 'string' ? b.setupUrl : undefined;
  const reason = humanReason(status);
  return new AgentcardError(`Agentcard ${reason} (HTTP ${status}) on ${method} ${path}`, {
    status,
    setupUrl,
    body,
  });
}

function humanReason(status: number): string {
  switch (status) {
    case 400:
      return 'invalid request';
    case 402:
      return 'payment declined';
    case 404:
      return 'not found';
    case 409:
      return 'duplicate';
    case 422:
      return 'no payment method';
    default:
      return 'error';
  }
}
