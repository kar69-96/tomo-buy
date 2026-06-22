/**
 * @tomo/funding — the card funding rail.
 *
 * - `AgentcardRail` implements `FundingRail` against the documented Agentcard
 *   REST API (M0: hold → capture → release). Cents-only; rejects > $50/card.
 * - `BuyToolRail` is the Lane A `/buy` stub — fails closed with
 *   EXPLAIN_CANT(lane_a_unavailable) until phase-06.
 * - Webhook verification + an append-only event store back `listTransactions`
 *   (the reconciliation source of truth).
 *
 * SECRET-FLOW: card PAN/CVV (from `getCardSecret`) flows ONLY to the Executor's
 * page-fill path — never to the LLM, never logged.
 */

export {
  AgentcardClient,
  AgentcardError,
  AGENTCARD_BASE_URL,
  type FetchLike,
  type AgentcardClientOptions,
  type CreateCardholderInput,
  type CardResponse,
  type CardDetailsResponse,
  type AgentcardErrorMeta,
} from './agentcard/client.js';

export {
  AgentcardRail,
  MIN_CARD_CENTS,
  MAX_CARD_CENTS,
  type AgentcardRailOptions,
  type CardholderProfile,
} from './agentcard/agentcard-rail.js';

export { WebhookEventStore } from './agentcard/event-store.js';
export { verifyAndIngest, verifySignature } from './agentcard/webhooks.js';

export { BuyToolRail, LaneAUnavailableError, LANE_A_UNAVAILABLE } from './buy-tool/buy-tool-rail-stub.js';
