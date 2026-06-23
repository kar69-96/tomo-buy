/**
 * StepTracker — tracks which checkout step the automation is at
 * based on tool calls and URL changes.
 */

import type { CheckoutStep } from "./task.js";

// Step ordering for regression prevention
const STEP_ORDER: readonly CheckoutStep[] = [
  "navigate",
  "add-to-cart",
  "proceed-to-checkout",
  "dismiss-popups",
  "fill-shipping",
  "select-shipping",
  "avoid-express-pay",
  "observe-card-fields",
  "fill-card",
  "fill-billing",
  "verify-email",
  "verify-price",
  "place-order",
  "verify-confirmation",
  "checkout-error",
];

function stepIndex(step: CheckoutStep): number {
  const idx = STEP_ORDER.indexOf(step);
  return idx === -1 ? 0 : idx;
}

interface ToolCall {
  readonly toolName: string;
  readonly input?: { action?: string };
}

// Tool name → checkout step
const TOOL_STEP_MAP: Readonly<Record<string, CheckoutStep>> = {
  fillShippingInfo: "fill-shipping",
  fillCardFields: "fill-card",
  fillBillingAddress: "fill-billing",
};

// Keywords in act actions → checkout step
const ACT_PATTERNS: readonly { pattern: RegExp; step: CheckoutStep }[] = [
  { pattern: /add to cart|add to bag/i, step: "add-to-cart" },
  { pattern: /select shipping|shipping option|shipping method/i, step: "select-shipping" },
  { pattern: /shop pay|express pay|decline.*pay|credit card/i, step: "avoid-express-pay" },
  { pattern: /place order|complete purchase|submit order/i, step: "place-order" },
  { pattern: /checkout|proceed/i, step: "proceed-to-checkout" },
];

// URL patterns → checkout step
const URL_PATTERNS: readonly { pattern: RegExp; step: CheckoutStep }[] = [
  { pattern: /\/confirmation|\/thank-you|\/order-complete/i, step: "verify-confirmation" },
];

export class StepTracker {
  private _currentStep: CheckoutStep = "navigate";

  get currentStep(): CheckoutStep {
    return this._currentStep;
  }

  /** Manually set the step (no regression guard). */
  setStep(step: CheckoutStep): void {
    this._currentStep = step;
  }

  /**
   * Update the tracker based on tool calls and/or current URL.
   * Will not regress to a step earlier in the checkout flow.
   */
  update(toolCalls: readonly ToolCall[], url?: string): void {
    // Check tool calls first
    for (const call of toolCalls) {
      // Direct tool name mapping
      const directStep = TOOL_STEP_MAP[call.toolName];
      if (directStep) {
        this.advanceTo(directStep);
        continue;
      }

      // Act action pattern matching
      if (call.toolName === "act" && call.input?.action) {
        for (const { pattern, step } of ACT_PATTERNS) {
          if (pattern.test(call.input.action)) {
            this.advanceTo(step);
            break;
          }
        }
      }
    }

    // Check URL patterns
    if (url) {
      for (const { pattern, step } of URL_PATTERNS) {
        if (pattern.test(url)) {
          this.advanceTo(step);
          break;
        }
      }
    }
  }

  /** Advance to a new step only if it's later in the flow. */
  private advanceTo(step: CheckoutStep): void {
    if (stepIndex(step) > stepIndex(this._currentStep)) {
      this._currentStep = step;
    }
  }
}
