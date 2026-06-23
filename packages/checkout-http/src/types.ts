/**
 * Package-internal types for the HTTP checkout engine.
 */

// ---- Session state (immutable per-flow) ----

export interface CookieEntry {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly expires?: number;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: "Strict" | "Lax" | "None";
}

export interface SessionState {
  readonly cookies: readonly CookieEntry[];
  readonly csrfToken?: string;
  readonly csrfTokenSource?: string;
  readonly authToken?: string;
  readonly customHeaders: Readonly<Record<string, string>>;
}

// ---- Page fetcher results ----

export interface RedirectEntry {
  readonly fromUrl: string;
  readonly toUrl: string;
  readonly statusCode: number;
}

export interface FetchResult {
  readonly url: string;
  readonly finalUrl: string;
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly contentType: string;
  readonly redirectChain: readonly RedirectEntry[];
  readonly setCookies: readonly string[];
}

// ---- SPA scoring ----

export interface SpaSignalResult {
  readonly name: string;
  readonly weight: number;
  readonly matched: boolean;
  readonly description: string;
}

export interface SpaScore {
  readonly score: number;
  readonly isServerRendered: boolean;
  readonly signals: readonly SpaSignalResult[];
}

// ---- Page parser output ----

export interface FormField {
  readonly name: string;
  readonly type: string;
  readonly value?: string;
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly autocomplete?: string;
}

export interface ParsedForm {
  readonly action: string;
  readonly method: string;
  readonly fields: readonly FormField[];
  readonly hiddenInputs: Readonly<Record<string, string>>;
}

export interface PageSnapshot {
  readonly url: string;
  readonly title: string;
  readonly forms: readonly ParsedForm[];
  readonly hiddenInputs: Readonly<Record<string, string>>;
  readonly inlineConfigs: readonly Record<string, unknown>[];
  readonly stripeKeys: readonly string[];
  readonly jsonLd: readonly Record<string, unknown>[];
  readonly metaTags: Readonly<Record<string, string>>;
  readonly links: readonly { href: string; text: string }[];
  readonly buttons: readonly { text: string; type?: string; selector: string }[];
  readonly scriptSrcs: readonly string[];
  readonly visibleTextLength: number;
}

// ---- Flow execution context ----

export interface ExecutionContext {
  readonly session: SessionState;
  readonly extractedValues: Readonly<Record<string, string>>;
  readonly stepResults: readonly StepResult[];
}

export interface StepResult {
  readonly stepIndex: number;
  readonly request: {
    readonly url: string;
    readonly method: string;
    readonly contentType?: string;
  };
  readonly response: FetchResult;
  readonly extractedValues: Readonly<Record<string, string>>;
  readonly durationMs: number;
}
