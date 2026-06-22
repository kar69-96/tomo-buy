import { NotImplementedError } from '@tomo/core';

/** Stub worker entrypoint. Registers + runs the Temporal worker. */
export function startWorker(): never {
  throw new NotImplementedError('worker.start');
}
