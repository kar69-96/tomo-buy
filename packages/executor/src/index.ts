import type { CardRef, PiiField } from '@tomo/core';
import { NotImplementedError } from '@tomo/core';

/**
 * Stub Executor. The ONLY component that opens secrets and injects them into a
 * page. Returns nothing but a success flag — never a secret. (Prime directive.)
 */
export class ExecutorStub {
  async fillAndSubmit(_cardRef: CardRef, _fields: PiiField[]): Promise<boolean> {
    throw new NotImplementedError('executor.fillAndSubmit');
  }
}
