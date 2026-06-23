import { describe, it, expect } from "vitest";
import { StepTracker } from "../src/step-tracker.js";

describe("StepTracker — checkout tool tracking", () => {
  it("tracks fillShippingInfo tool call", () => {
    const tracker = new StepTracker();
    tracker.update([{ toolName: "fillShippingInfo" }]);
    expect(tracker.currentStep).toBe("fill-shipping");
  });

  it("tracks fillCardFields tool call", () => {
    const tracker = new StepTracker();
    tracker.update([{ toolName: "fillCardFields" }]);
    expect(tracker.currentStep).toBe("fill-card");
  });

  it("tracks fillBillingAddress tool call", () => {
    const tracker = new StepTracker();
    tracker.update([{ toolName: "fillBillingAddress" }]);
    expect(tracker.currentStep).toBe("fill-billing");
  });

  it("infers add-to-cart from act action", () => {
    const tracker = new StepTracker();
    tracker.update([{ toolName: "act", input: { action: "Click Add to Cart button" } }]);
    expect(tracker.currentStep).toBe("add-to-cart");
  });

  it("infers shipping selection from act action", () => {
    const tracker = new StepTracker();
    tracker.update([{ toolName: "act", input: { action: "Select shipping option: Standard Delivery" } }]);
    expect(tracker.currentStep).toBe("select-shipping");
  });

  it("infers express pay avoidance from act action", () => {
    const tracker = new StepTracker();
    tracker.update([{ toolName: "act", input: { action: "Decline Shop Pay and use credit card" } }]);
    expect(tracker.currentStep).toBe("avoid-express-pay");
  });

  it("infers place order from act action", () => {
    const tracker = new StepTracker();
    tracker.update([{ toolName: "act", input: { action: "Click Place Order button" } }]);
    expect(tracker.currentStep).toBe("place-order");
  });

  it("detects confirmation page from URL", () => {
    const tracker = new StepTracker();
    tracker.setStep("place-order");
    tracker.update([], "https://example.com/confirmation/12345");
    expect(tracker.currentStep).toBe("verify-confirmation");
  });

  it("detects thank-you page from URL", () => {
    const tracker = new StepTracker();
    tracker.setStep("place-order");
    tracker.update([], "https://example.com/thank-you");
    expect(tracker.currentStep).toBe("verify-confirmation");
  });

  it("does not downgrade from shipping to checkout when already past that phase", () => {
    const tracker = new StepTracker();
    tracker.setStep("fill-shipping");
    tracker.update([], "https://example.com/checkout/step2");
    // Should NOT regress to proceed-to-checkout
    expect(tracker.currentStep).toBe("fill-shipping");
  });
});
