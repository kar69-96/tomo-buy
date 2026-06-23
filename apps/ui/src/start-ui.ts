/**
 * Process entry point for `pnpm --filter @tomo/ui start`. Boots the portal.
 * Exercised by the live run, not unit tests.
 *
 * Wire a real LLM `complete` here for the live path (the api refuses intent
 * parsing without one). Secrets come from the environment (.env), never the CLI.
 */
/* v8 ignore start */
import { startUi } from './index.js';

async function main(): Promise<void> {
  const server = await startUi();
  const shutdown = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(`failed to start tomo-buy portal: ${String(err)}\n`);
  process.exit(1);
});
/* v8 ignore stop */
