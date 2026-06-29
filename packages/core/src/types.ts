// ---- Order ----

export type OrderStatus =
  | "awaiting_confirmation"
  | "processing"
  | "completed"
  | "failed"
  | "expired";

export interface ProductInfo {
  name: string;
  url: string;
  price: string;
  source: string;
  image_url?: string;
}

export interface PaymentInfo {
  total: string;
  price: string;
  fee: string;
  fee_rate: string;
}

export interface Order {
  order_id: string;
  status: OrderStatus;
  product: ProductInfo;
  payment: PaymentInfo;
  shipping?: ShippingInfo;
  selections?: Record<string, string>;
  receipt?: Receipt;
  error?: OrderError;
  created_at: string;
  confirmed_at?: string;
  completed_at?: string;
  expires_at: string;
}

// ---- Receipt ----

export interface Receipt {
  product: string;
  merchant: string;
  price: string;
  fee: string;
  total_paid: string;
  timestamp: string;
  order_number?: string;
  estimated_delivery?: string;
  confirmation_email?: string;
  browserbase_session_id?: string;
}

// ---- Shipping ----

export interface ShippingInfo {
  name: string;
  street: string;
  apartment?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  email: string;
  phone: string;
}

// ---- Product Discovery ----

export interface ProductOption {
  name: string; // e.g. "Color", "Size"
  values: string[]; // e.g. ["Red", "Blue", "Green"]
  prices?: Record<string, string>; // value → price, e.g. { "Size 10": "100.00" }
}

export interface RichProductInfo {
  name: string;
  url: string;
  price: string;
  original_price?: string;
  currency?: string;
  brand?: string;
  image_url?: string;
}

export interface RequiredField {
  field: string; // e.g. "shipping.email", "selections"
  label: string; // e.g. "Email address"
}

export interface QueryResponse {
  product: RichProductInfo;
  options: ProductOption[];
  required_fields: RequiredField[];
  discovery_method: string;
}

// ---- Search (NL query) ----

export interface SearchProductResult {
  product: RichProductInfo;
  options: ProductOption[];
  required_fields: RequiredField[];
  discovery_method: string;
  relevance_score: number;
}

export interface SearchQueryResponse {
  type: "search";
  query: string;
  products: SearchProductResult[];
  search_metadata: {
    total_found: number;
    domain_filter?: string[];
    price_filter?: { min?: number; max?: number };
  };
}

// ---- Card & Billing ----

export interface CardInfo {
  number: string;
  expiry: string;
  cvv: string;
  cardholder_name: string;
}

export interface BillingInfo {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

// ---- Credentials Map ----

export interface CredentialsMap {
  x_card_number: string;
  x_card_expiry: string;
  x_card_cvv: string;
  x_cardholder_name: string;
  x_billing_street: string;
  x_billing_city: string;
  x_billing_state: string;
  x_billing_zip: string;
  x_billing_country: string;
  x_shipping_name: string;
  x_shipping_street: string;
  x_shipping_city: string;
  x_shipping_state: string;
  x_shipping_zip: string;
  x_shipping_country: string;
  x_shipping_apartment: string;
  x_shipping_email: string;
  x_shipping_phone: string;
}

// ---- Order Error ----

export interface OrderError {
  code: string;
  message: string;
}

// ---- Domain Cache ----

export interface DomainCache {
  domain: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
  }>;
  localStorage?: Record<string, string>;
  updated_at: string;
}

// ---- Checkout Error Classification ----

export type CheckoutErrorCategory =
  | "bot_detected"
  | "form_fill_failed"
  | "payment_rejected"
  | "navigation_failed"
  | "captcha_unsolved"
  | "session_timeout"
  | "unknown";

// ---- Agent Identities & Connected Accounts ----

/**
 * A self-owned identity the agent can use to get past login gates on services
 * that do NOT require the user's personal account. Has its own email (AgentMail
 * inbox) and a password stored in the vault (referenced, never inlined).
 */
export interface AgentIdentity {
  identity_id: string; // tomo_id_*
  label: string;
  email: string; // agent's own email (AgentMail inbox)
  inbox_id?: string; // AgentMail inbox id backing `email`, when available
  vault_ref_password?: string; // opaque vault key; the secret never lives here
  created_at: string;
  updated_at: string;
}

/**
 * Public profile data for an agent identity, used to fill multi-field signup
 * forms (name, phone). LLM-safe — these are NOT secrets and may be seen by the
 * model. Config-sourced (AGENT_NAME / AGENT_PHONE), like card/shipping/billing.
 */
export interface AgentProfile {
  name: string;
  phone: string;
}

/**
 * A connection to the user's real email/provider (via Composio). Used both to
 * decide whether the user already has an account on a service and to read OTP
 * codes. `status` is "stub" until Composio is actually wired.
 */
export interface ConnectedAccount {
  account_id: string; // tomo_acct_*
  provider: "composio";
  email: string;
  status: "stub" | "connected";
  domains?: string[]; // services known to be tied to this account
  created_at: string;
  updated_at: string;
}

/** An agent identity's account on one specific site (created on demand). */
export interface SiteAccount {
  identity_id: string;
  domain: string;
  username: string;
  vault_ref_password: string;
  created_at: string;
}

/** How the browser should get past a login gate. */
export type LoginStrategy =
  | "connected_otp" // user's account, log in via OTP read from connected email
  | "connected_session" // user's account, log in via provided session token/cookies
  | "agent" // agent identity (own email + vaulted password)
  | "guest"; // skip login (existing default behavior)

// ---- Planner Runs ----

export type RunStatus =
  | "planning"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed";

export type GateType = "create_account" | "session_token" | "purchase_confirm";

export interface RunGate {
  type: GateType;
  /** Human-readable context for the approval decision (e.g. price breakdown). */
  details: Record<string, unknown>;
}

export interface PlanStep {
  capability: string; // see @tomo/planner capability registry
  args: Record<string, unknown>;
  identity_strategy?: LoginStrategy;
  gate?: GateType;
}

export interface ExecutionPlan {
  task: string;
  steps: PlanStep[];
  /** High-detail, structured brief handed to the execution agent (no secrets). */
  brief?: ExecutionBrief;
}

// ---- Execution Brief (high-detail planner output) ----

/** How the executor is expected to get past the login gate (informational). */
export type BriefLoginType =
  | "email_otp"
  | "password"
  | "session"
  | "agent"
  | "none"
  | "unknown";

export interface BriefTarget {
  /** Human-readable site/service name, e.g. "Acme Tickets". */
  site: string;
  /** Best resolved entry URL for the task (grounded when possible). */
  url: string;
  /** Bare hostname, e.g. "example.com". */
  domain: string;
}

export interface BriefLogin {
  required: boolean;
  type: BriefLoginType;
  notes?: string;
}

/** A grounded option surfaced by Exa/discovery during planning. */
export interface BriefCandidate {
  name: string;
  url: string;
  price?: string;
}

export interface BriefGrounding {
  /** "exa+discovery" | "url-fetch" | "llm-only" | "fallback". */
  method: string;
  candidates?: BriefCandidate[];
}

/**
 * A high-detail, structured brief the planner hands to the execution agent.
 * Carries only task intent + grounded facts — NEVER any secret. Facts that can
 * only be known at run time (a specific available option/time, live availability) are
 * listed in `resolve_live` as instructions, never invented at plan time.
 */
/**
 * How the executor should drive the task:
 *  - "product"   — a concrete item with an Add-to-Cart/Buy button: the scripted
 *                  product → cart → checkout handlers apply.
 *  - "form_flow" — a multi-step, form-driven flow (flight/hotel booking, a
 *                  reservation, an appointment, a registration): there is no
 *                  add-to-cart; the LLM drives every page from the brief.
 * Chosen by the planner from task intent, NOT from whether discovery happened to
 * scrape a price — so a booking is never misrouted into the add-to-cart path.
 */
export type BriefFlow = "product" | "form_flow";

export interface ExecutionBrief {
  /** One-line restatement of the resolved goal. */
  objective: string;
  target: BriefTarget;
  login: BriefLogin;
  /** How the executor drives this task (product vs multi-step form flow). */
  flow?: BriefFlow;
  /** Domain-specific structured parameters parsed from the task. */
  parameters: Record<string, string>;
  /** Hard requirements/preferences the executor must honor. */
  constraints: string[];
  /** Ordered, concrete instructions for the headless execution agent. */
  execution_steps: string[];
  /** Facts the executor must resolve live (not invented at plan time). */
  resolve_live: string[];
  grounding?: BriefGrounding;
}

/**
 * Whether a brief should be driven by the LLM page-by-page (a multi-step form
 * flow) rather than by the scripted product/cart handlers. Single source of
 * truth shared by the planner (run executor) and the checkout engine so the two
 * never disagree about which executor owns a task.
 *
 * Priority: an explicit planner `flow` wins. Absent that, fall back to the
 * heuristic — structured parameters present AND no real product candidate found.
 * A booking/reservation never depends on a scraped price to route correctly.
 */
export function isFormFlowBrief(brief: ExecutionBrief | undefined): boolean {
  if (!brief) return false;
  if (brief.flow === "form_flow") return true;
  if (brief.flow === "product") return false;
  const hasParams = Object.keys(brief.parameters ?? {}).length > 0;
  const foundProduct = (brief.grounding?.candidates ?? []).length > 0;
  return hasParams && !foundProduct;
}

export interface Run {
  run_id: string; // tomo_run_*
  task: string;
  status: RunStatus;
  plan?: ExecutionPlan;
  cursor: number; // index of the next step to execute
  gate?: RunGate; // present when status === "awaiting_approval"
  context?: Record<string, unknown>; // accumulated execution state (url, order_id, ...)
  result?: Record<string, unknown>;
  error?: OrderError;
  created_at: string;
  updated_at: string;
}

// ---- Store Schemas ----

export interface OrdersStore {
  orders: Order[];
}

export interface AgentIdentitiesStore {
  identities: AgentIdentity[];
}

export interface ConnectedAccountsStore {
  accounts: ConnectedAccount[];
}

export interface SiteAccountsStore {
  site_accounts: SiteAccount[];
}

export interface RunsStore {
  runs: Run[];
}

export interface TomoConfig {
  default_order_expiry_seconds: number;
  port: number;
}

// ---- Cost Tracking ----

export interface CostEntry {
  label: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  costUsd: number;
  durationMs: number;
}

export interface SessionCostEntry {
  sessionId: string;
  durationMs: number;
  costUsd: number;
}

export interface CostBreakdown {
  llmCalls: CostEntry[];
  sessions: SessionCostEntry[];
  totalInputTokens: number;
  totalOutputTokens: number;
  llmCostUsd: number;
  sessionCostUsd: number;
  totalCostUsd: number;
}

// ---- Error Codes ----

export const ErrorCodes = {
  SHIPPING_REQUIRED: "SHIPPING_REQUIRED",
  ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
  ORDER_EXPIRED: "ORDER_EXPIRED",
  URL_UNREACHABLE: "URL_UNREACHABLE",
  PRICE_EXTRACTION_FAILED: "PRICE_EXTRACTION_FAILED",
  CHECKOUT_FAILED: "CHECKOUT_FAILED",
  CHECKOUT_DECLINED: "CHECKOUT_DECLINED",
  MISSING_FIELD: "MISSING_FIELD",
  INVALID_URL: "INVALID_URL",
  ORDER_INVALID_STATUS: "ORDER_INVALID_STATUS",
  INVALID_SELECTION: "INVALID_SELECTION",
  QUERY_FAILED: "QUERY_FAILED",
  SEARCH_NO_RESULTS: "SEARCH_NO_RESULTS",
  SEARCH_UNAVAILABLE: "SEARCH_UNAVAILABLE",
  SEARCH_RATE_LIMITED: "SEARCH_RATE_LIMITED",
  IDENTITY_NOT_FOUND: "IDENTITY_NOT_FOUND",
  LOGIN_FAILED: "LOGIN_FAILED",
  VAULT_LOCKED: "VAULT_LOCKED",
  COMPOSIO_NOT_CONNECTED: "COMPOSIO_NOT_CONNECTED",
  RUN_NOT_FOUND: "RUN_NOT_FOUND",
  RUN_INVALID_STATE: "RUN_INVALID_STATE",
  PLAN_FAILED: "PLAN_FAILED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class TomoError extends Error {
  code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "TomoError";
    this.code = code;
  }
}
