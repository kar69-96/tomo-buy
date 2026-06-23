// ---- Browserbase session lifecycle ----

export interface BrowserbaseSession {
  id: string;
  connectUrl: string;
  replayUrl: string;
}

export interface SessionOptions {
  stealth?: boolean;
  proxies?: boolean;
  logSession?: boolean;
}

const SESSION_TIMEOUT_MS = 25 * 60 * 1000;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 3000;
const BROWSERBASE_API_URL = "https://api.browserbase.com/v1/sessions";

export function getBrowserbaseConfig(): {
  apiKey: string;
  projectId: string;
} {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  if (!apiKey) {
    throw new Error("BROWSERBASE_API_KEY is required");
  }
  if (!projectId) {
    throw new Error("BROWSERBASE_PROJECT_ID is required");
  }

  return { apiKey, projectId };
}

export function getModelApiKey(): string {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error("GOOGLE_API_KEY is required");
  }
  return key;
}

export function getQueryModelApiKey(): string {
  const key = process.env.GOOGLE_API_KEY_QUERY;
  if (!key) {
    throw new Error("GOOGLE_API_KEY_QUERY is required");
  }
  return key;
}

export function getAnthropicApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }
  return key;
}

export async function createSession(options?: SessionOptions): Promise<BrowserbaseSession> {
  const { apiKey, projectId } = getBrowserbaseConfig();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(BROWSERBASE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bb-api-key": apiKey,
      },
      body: JSON.stringify({
        projectId,
        ...(options?.proxies && { proxies: true }),
        browserSettings: {
          recordSession: true,
          logSession: true,
          solveCaptchas: true,
          ...(options?.stealth && { stealth: true }),
        },
        timeout: SESSION_TIMEOUT_MS / 1000,
      }),
    });

    if (response.status === 429 && attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Browserbase session creation failed (${response.status}): ${body}`,
      );
    }

    const data = (await response.json()) as {
      id: string;
      connectUrl: string;
    };

    return {
      id: data.id,
      connectUrl: data.connectUrl,
      replayUrl: `https://browserbase.com/sessions/${data.id}`,
    };
  }

  throw new Error("Browserbase session creation failed: max retries exceeded");
}

export async function destroySession(sessionId: string): Promise<void> {
  try {
    const { apiKey, projectId } = getBrowserbaseConfig();
    await fetch(`${BROWSERBASE_API_URL}/${sessionId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bb-api-key": apiKey,
      },
      body: JSON.stringify({ projectId, status: "REQUEST_RELEASE" }),
    });
  } catch {
    // Belt-and-suspenders: never throw from cleanup
  }
}
