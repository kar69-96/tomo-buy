/**
 * Environment loading + validation for the live server. Fail fast with a clear
 * message when a required secret is missing — never boot the live path half-wired.
 * Secrets are read here (trusted side) and never returned to the LLM or logged.
 */
export interface ApiConfig {
  readonly agentcardApiKey: string;
  readonly agentcardBaseUrl?: string;
  readonly webhookSecret: string;
  readonly vaultMasterKey: string;
  readonly signerPassphrase: string;
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  readonly port: number;
}

const REQUIRED = [
  'AGENTCARD_API_KEY',
  'WEBHOOK_SECRET',
  'VAULT_MASTER_KEY',
  'MANDATE_PASSPHRASE',
] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const missing = REQUIRED.filter((key) => !env[key] || env[key]!.trim() === '');
  if (missing.length > 0) {
    throw new Error(
      `missing required environment variable(s): ${missing.join(', ')}. ` +
        `See .env.example. Live secrets are never committed.`,
    );
  }

  const port = env.PORT ? Number(env.PORT) : 8787;
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`invalid PORT '${env.PORT}': must be a positive integer`);
  }

  return {
    agentcardApiKey: env.AGENTCARD_API_KEY!,
    ...(env.AGENTCARD_API_BASE ? { agentcardBaseUrl: env.AGENTCARD_API_BASE } : {}),
    webhookSecret: env.WEBHOOK_SECRET!,
    vaultMasterKey: env.VAULT_MASTER_KEY!,
    signerPassphrase: env.MANDATE_PASSPHRASE!,
    temporalAddress: env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233',
    temporalNamespace: env.TEMPORAL_NAMESPACE ?? 'default',
    port,
  };
}
