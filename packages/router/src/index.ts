/**
 * @tomo/router — the deterministic routing cascade (§6).
 *
 * `route(profile, intent)` is a pure function: given a merchant profile and a
 * parsed, validated intent, it returns the `RoutingDecision` (a path plus
 * human-readable reasons, and an `explain_cant` detail on terminal refusals).
 * No LLM, no IO, no clock.
 */
export { route } from './cascade.js';
