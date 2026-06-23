/**
 * Provision and resolve agent identities + their per-site accounts.
 *
 * An agent identity is a self-owned persona (its own AgentMail email + a vaulted
 * password) used to get past login gates on services that do NOT require the
 * user's personal account. Passwords live in the vault; only refs are persisted.
 */
import {
  generateId,
  getIdentities,
  getIdentity,
  createIdentity,
  getSiteAccount,
  createSiteAccount,
} from "@tomo/core";
import type { AgentIdentity, SiteAccount } from "@tomo/core";
import { provisionInbox } from "./agentmail.js";
import { putSecret, getSecret, generatePassword } from "./vault.js";

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Return the default agent identity, creating one (with an AgentMail inbox) on
 * first use. A single shared persona is sufficient for v1.
 */
export async function getOrCreateAgentIdentity(
  label = "default",
): Promise<AgentIdentity> {
  const existing = getIdentities().find((i) => i.label === label);
  if (existing) return existing;

  const identityId = generateId("id");
  const inbox = await provisionInbox(identityId);
  const ts = nowIso();
  const identity: AgentIdentity = {
    identity_id: identityId,
    label,
    email: inbox.email,
    inbox_id: inbox.inboxId ?? undefined,
    created_at: ts,
    updated_at: ts,
  };
  await createIdentity(identity);
  return identity;
}

export interface SiteAccountSecret {
  account: SiteAccount;
  /** Plaintext password — for the login/CDP fill path only, never logged/LLM. */
  password: string;
}

/**
 * Get the agent identity's account on `domain`, creating one (with a fresh
 * vaulted password) if it does not exist yet. The returned password is meant to
 * flow straight into the login fill path.
 */
export async function getOrCreateSiteAccount(
  identity: AgentIdentity,
  domain: string,
): Promise<SiteAccountSecret> {
  const existing = getSiteAccount(identity.identity_id, domain);
  if (existing) {
    return { account: existing, password: getSecret(existing.vault_ref_password) };
  }

  const password = generatePassword();
  const ref = await putSecret(password);
  const account: SiteAccount = {
    identity_id: identity.identity_id,
    domain,
    username: identity.email,
    vault_ref_password: ref,
    created_at: nowIso(),
  };
  await createSiteAccount(account);
  return { account, password };
}

export function getAgentIdentity(id: string): AgentIdentity | undefined {
  return getIdentity(id);
}
