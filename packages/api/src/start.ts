/**
 * `startServer` — the live composition root. Builds real deps, connects a Temporal
 * client, starts an in-process worker, and serves the Hono app (incl. the portal).
 * Integration glue exercised by the live run (`pnpm --filter @tomo/ui start`), not
 * by unit tests — the testable logic is the routes + `checkout-deps` + adapters.
 */
/* v8 ignore start */
import { serve } from '@hono/node-server';
import { Client, Connection } from '@temporalio/client';
import { buildWorker } from '@tomo/worker';
import { getProfile } from '@tomo/profiles';
import { createApp } from './server.js';
import { buildCheckoutDeps, type CompositionEnv } from './composition.js';
import { makeTemporalAdapter } from './temporal.js';
import { makeWebhookSink } from './webhook/sink.js';
import { createMandateSigner } from './mandate-signer.js';
import { WorkflowStore } from './workflow-store.js';
import { OtpRelay } from './otp/relay.js';
import { loadConfig, type ApiConfig } from './config.js';
import type { CompleteFn } from './ports.js';

export interface StartServerOptions {
  readonly config?: ApiConfig;
  /** LLM completion for intent parsing. Required for the live path. */
  readonly complete?: CompleteFn;
  /** Composition overrides (e.g. confirmation selector, cardholder resolver). */
  readonly composition?: Partial<Omit<CompositionEnv, 'config'>>;
}

export interface RunningServer {
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

const noLlm: CompleteFn = async () => {
  throw new Error(
    'No LLM `complete` configured. Pass startServer({ complete }) wired to your provider.',
  );
};

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const config = options.config ?? loadConfig();

  const { deps, eventStore } = buildCheckoutDeps({ config, ...options.composition });

  // Worker (in-process) running the checkout workflow against the dev server.
  const { worker, close: closeWorker } = await buildWorker({ deps, address: config.temporalAddress });
  const workerRun = worker.run();

  // Temporal client for the api routes.
  const connection = await Connection.connect({ address: config.temporalAddress });
  const client = new Client({ connection, namespace: config.temporalNamespace });

  const app = createApp({
    temporal: makeTemporalAdapter(client),
    complete: options.complete ?? noLlm,
    getProfile,
    signer: createMandateSigner(config.signerPassphrase),
    store: new WorkflowStore(),
    otp: new OtpRelay(),
    webhook: makeWebhookSink(eventStore, config.webhookSecret),
  });

  const server = serve({ fetch: app.fetch, port: config.port });
  const url = `http://localhost:${config.port}`;

  return {
    url,
    port: config.port,
    async close() {
      server.close();
      worker.shutdown();
      await workerRun.catch(() => {});
      await closeWorker();
      await connection.close();
    },
  };
}
/* v8 ignore stop */
