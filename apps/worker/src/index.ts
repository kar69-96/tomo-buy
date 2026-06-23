/**
 * @tomo/worker — Temporal worker app for the checkout state machine.
 *
 * Registers the `checkout` workflow + activities against the local dev server.
 * Wave-3 supplies real `CheckoutDeps`; `stubDeps` lets the process boot today.
 */
export { buildWorker, startWorker, workflowsPath, type BuildWorkerOptions } from './worker.js';
export { stubDeps } from './stub-deps.js';
