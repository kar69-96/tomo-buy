import type { TaskIntent } from '@tomo/core';
import { NotImplementedError } from '@tomo/core';

/** Stub intent parser. Emits a validated TaskIntent (references only, no secrets). */
export class IntentParserStub {
  async parse(_prompt: string): Promise<TaskIntent> {
    throw new NotImplementedError('intent.parse');
  }
}
