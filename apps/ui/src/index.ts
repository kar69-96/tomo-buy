/**
 * @tomo/ui — the minimal text/portal launcher. The portal itself (prompt → plan →
 * approve / reject + OTP relay) is served by `@tomo/api` at `GET /`; this app just
 * boots that server and prints the URL. The `start` seam is injectable so the
 * launcher is unit-testable without a live Temporal/Agentcard environment.
 */
import { startServer, type RunningServer, type StartServerOptions } from '@tomo/api';

export interface StartUiOptions extends StartServerOptions {
  /** Server starter (defaults to @tomo/api startServer) — overridable in tests. */
  readonly start?: (opts?: StartServerOptions) => Promise<RunningServer>;
  /** Output sink for the ready banner (defaults to stdout). */
  readonly logger?: (message: string) => void;
}

export async function startUi(options: StartUiOptions = {}): Promise<RunningServer> {
  const {
    start = startServer,
    logger = (m: string) => process.stdout.write(`${m}\n`),
    ...serverOptions
  } = options;
  const server = await start(serverOptions);
  logger(`Tomo-buy portal ready — open ${server.url} to approve + relay OTP.`);
  return server;
}
