import type { VaultA, VaultB, AgentCredential, PiiField } from '@tomo/core';
import { NotImplementedError } from '@tomo/core';

/** Stub Vault A — Executor-only agent-secret store. */
export class VaultAStub implements VaultA {
  async read(_user: string, _merchant: string): Promise<AgentCredential> {
    throw new NotImplementedError('vaults.VaultA.read');
  }
}

/** Stub Vault B — field-level PII release, Executor-only. */
export class VaultBStub implements VaultB {
  async releaseField(_user: string, _field: PiiField): Promise<string> {
    throw new NotImplementedError('vaults.VaultB.releaseField');
  }
}
