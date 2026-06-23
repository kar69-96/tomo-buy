// ---- Per-domain cache: IDEAL tooling (Browserbase Contexts) ----
//
// The production-grade counterpart to the file cache in cache.ts. Instead of
// shuttling cookies through our own process, we lean on Browserbase "Contexts":
// a server-side persistent browser profile that Browserbase reloads automatically
// on the next session. Cookies / localStorage / cache stay inside the cloud
// browser and never touch our disk or logs.
//
// We keep ONE context per domain. The domain -> contextId mapping is the only
// thing stored locally (~/.tomo/cache/_browserbase-contexts.json); the actual
// browsing state lives on Browserbase. The session then boots with
// browserSettings.context = { id, persist: true } (see browserbase-session.ts).
//
// Stub status: the REST wiring (create-context fetch + the session-request
// context block) is real, but it stays dormant unless BROWSER_RUNTIME=browserbase
// AND BROWSERBASE_API_KEY/PROJECT_ID are set. On the debugging runtime none of
// this loads — cache.ts handles everything and the repo runs out of the box.

import * as fs from "node:fs";
import * as path from "node:path";
import { getCacheDir } from "./cache.js";

const BROWSERBASE_API = "https://api.browserbase.com/v1";

// ---- domain -> contextId map (the only thing we persist locally) ----

function getContextMapPath(): string {
  return path.join(getCacheDir(), "_browserbase-contexts.json");
}

type ContextMap = Record<string, string>;

export function loadContextMap(): ContextMap {
  try {
    const data = fs.readFileSync(getContextMapPath(), "utf-8");
    const parsed = JSON.parse(data) as ContextMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Look up the Browserbase context id we've associated with a domain, if any. */
export function loadContextId(domain: string): string | null {
  return loadContextMap()[domain] ?? null;
}

/** Persist a domain -> contextId association (immutable update of the map file). */
export function saveContextId(domain: string, contextId: string): void {
  const dir = getCacheDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const next: ContextMap = { ...loadContextMap(), [domain]: contextId };
  const filepath = getContextMapPath();
  const tmpPath = filepath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, filepath);
}

// ---- session-request context block (pure / testable) ----

export interface ContextSetting {
  id: string;
  /** Save state back to the context when the session ends. */
  persist: boolean;
}

/** The `browserSettings.context` block for a session-create request (pure). */
export function buildContextSetting(
  contextId: string,
  persist = true,
): ContextSetting {
  return { id: contextId, persist };
}

// ---- create-context REST wiring (stubbed: dormant without keys) ----

interface CreateContextResponse {
  id: string;
}

/** Create a fresh Browserbase context for a project. Returns its id. */
export async function createRemoteContext(
  apiKey: string,
  projectId: string,
): Promise<string> {
  const res = await fetch(`${BROWSERBASE_API}/contexts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BB-API-Key": apiKey,
    },
    body: JSON.stringify({ projectId }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Browserbase context ${res.status}: ${errBody.slice(0, 300)}`);
  }
  const data = (await res.json()) as Partial<CreateContextResponse>;
  if (!data.id) {
    throw new Error("Browserbase context-create returned no id");
  }
  return data.id;
}

/**
 * Resolve the persistent context id for a domain: reuse the one we already
 * mapped, or create a new one on Browserbase and remember it. Best-effort —
 * returns null on any failure so checkout falls back to a fresh session rather
 * than aborting.
 */
export async function resolveContextId(
  domain: string,
  apiKey: string,
  projectId: string,
): Promise<string | null> {
  const existing = loadContextId(domain);
  if (existing) return existing;
  try {
    const id = await createRemoteContext(apiKey, projectId);
    saveContextId(domain, id);
    return id;
  } catch {
    return null;
  }
}
