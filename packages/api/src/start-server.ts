/**
 * Process entry point for `pnpm --filter @tomo/api start`. Boots the live server.
 * Exercised by the live run, not unit tests.
 */
/* v8 ignore start */
import { startServer } from './start.js';

async function main(): Promise<void> {
  const server = await startServer();
  process.stdout.write(`tomo-buy api + portal listening on ${server.url}\n`);
  const shutdown = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(`failed to start tomo-buy api: ${String(err)}\n`);
  process.exit(1);
});
/* v8 ignore stop */
