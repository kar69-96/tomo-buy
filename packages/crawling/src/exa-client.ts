/**
 * Shared Exa.ai client singleton.
 * Reused by exa-extract (single-URL) and exa-search (NL search).
 */

import Exa from "exa-js";

let cachedExa: InstanceType<typeof Exa> | null = null;

export function getExaClient(): InstanceType<typeof Exa> | null {
  const key = process.env.EXA_API_KEY;
  if (!key) return null;
  if (!cachedExa) {
    cachedExa = new Exa(key);
  }
  return cachedExa;
}
