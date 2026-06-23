/**
 * @tomo/worker — the Temporal worker that runs the checkout state machine.
 *
 * It registers the `checkout` workflow (bundled from `@tomo/orchestrator/workflow`,
 * a real .js entry so the worker's bundler never trips over TS `.js` import
 * specifiers) and the activity implementations built from an injected
 * `CheckoutDeps`. Connects to the free local `temporal server start-dev`.
 *
 * SECRET-FLOW RULE: activities are the trusted side. The worker process is where
 * PAN injection will happen in Wave-3; nothing here returns a secret to a caller.
 */
import { createRequire } from 'node:module';
import { NativeConnection, Worker } from '@temporalio/worker';
import { createActivities, CHECKOUT_TASK_QUEUE, type CheckoutDeps } from '@tomo/orchestrator';

/** Absolute path to the pre-built workflow bundle the worker registers. */
export const workflowsPath = createRequire(import.meta.url).resolve('@tomo/orchestrator/workflow');

export interface BuildWorkerOptions {
  /** Concrete funding rail / executor / event-store seam (Wave-3 or test mocks). */
  deps: CheckoutDeps;
  /** An already-open native connection (tests pass the test env's connection). */
  connection?: NativeConnection;
  /** Server address when opening our own connection. Defaults to localhost:7233. */
  address?: string;
  /** Task queue override; defaults to the orchestrator's CHECKOUT_TASK_QUEUE. */
  taskQueue?: string;
  /** Temporal namespace; defaults to 'default'. */
  namespace?: string;
}

/**
 * Build (but do not run) a configured Worker. Returns the worker plus a
 * disposer for any connection this function opened (none if one was injected).
 */
export async function buildWorker(
  options: BuildWorkerOptions,
): Promise<{ worker: Worker; close: () => Promise<void> }> {
  const taskQueue = options.taskQueue ?? CHECKOUT_TASK_QUEUE;
  const ownsConnection = !options.connection;
  const connection =
    options.connection ??
    (await NativeConnection.connect({ address: options.address ?? 'localhost:7233' }));

  try {
    const worker = await Worker.create({
      connection,
      namespace: options.namespace ?? 'default',
      taskQueue,
      workflowsPath,
      activities: createActivities(options.deps),
    });
    return {
      worker,
      close: async () => {
        if (ownsConnection) await connection.close();
      },
    };
    /* v8 ignore start */ // defensive cleanup if Worker.create fails after we opened a connection
  } catch (err) {
    if (ownsConnection) await connection.close();
    throw err;
  }
  /* v8 ignore stop */
}

/**
 * Start a long-running worker against the local dev server and block until it
 * is shut down. This is the process entry point — it runs forever, so it is
 * exercised by the manual `temporal server start-dev` smoke run rather than a
 * unit test (which is what `buildWorker` is for, and is fully covered).
 */
/* v8 ignore start */
export async function startWorker(deps: CheckoutDeps): Promise<void> {
  const { worker, close } = await buildWorker({ deps });
  try {
    await worker.run();
  } finally {
    await close();
  }
}
/* v8 ignore stop */
