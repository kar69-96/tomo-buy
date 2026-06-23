import { describe, it, expect, vi } from "vitest";
import {
  scriptedClickButton,
  scriptedSelectOption,
  scriptedClickSelector,
} from "../src/scripted-actions.js";

/** Minimal Playwright Page stub whose page.evaluate result we control. */
function pageWithEvaluate(result: unknown) {
  return {
    evaluate: vi.fn().mockResolvedValue(result),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
  } as never;
}

describe("scriptedClickButton sink", () => {
  it("invokes the sink with the element descriptor on a match", async () => {
    const page = pageWithEvaluate({ clicked: true, selector: "#go", text: "Checkout" });
    const sink = vi.fn();
    const ok = await scriptedClickButton(page, "checkout", sink);
    expect(ok).toBe(true);
    expect(sink).toHaveBeenCalledWith({ selector: "#go", text: "Checkout" });
  });

  it("falls back to the target text when no descriptor is available", async () => {
    const page = pageWithEvaluate({ clicked: true, selector: undefined, text: "" });
    const sink = vi.fn();
    await scriptedClickButton(page, "place order", sink);
    expect(sink).toHaveBeenCalledWith({ selector: undefined, text: "place order" });
  });

  it("does not call the sink when nothing matched", async () => {
    const page = pageWithEvaluate({ clicked: false, selector: undefined, text: "" });
    const sink = vi.fn();
    const ok = await scriptedClickButton(page, "checkout", sink);
    expect(ok).toBe(false);
    expect(sink).not.toHaveBeenCalled();
  });

  it("works without a sink (backward compatible)", async () => {
    const page = pageWithEvaluate({ clicked: true, selector: "#go", text: "x" });
    expect(await scriptedClickButton(page, "checkout")).toBe(true);
  });
});

describe("scriptedSelectOption sink", () => {
  it("invokes the sink on a selection", async () => {
    const page = pageWithEvaluate({ selected: true, selector: '[role="radio"]', text: "One time" });
    const sink = vi.fn();
    const ok = await scriptedSelectOption(page, "one time", "radio", sink);
    expect(ok).toBe(true);
    expect(sink).toHaveBeenCalledWith({ selector: '[role="radio"]', text: "One time" });
  });
});

describe("scriptedClickSelector (read-back)", () => {
  it("clicks via the provided locator and returns true", async () => {
    const click = vi.fn().mockResolvedValue(undefined);
    const page = {
      locator: vi.fn().mockReturnValue({ first: () => ({ click }) }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as never;
    const ok = await scriptedClickSelector(page, "#checkout");
    expect(ok).toBe(true);
    expect(click).toHaveBeenCalled();
  });

  it("returns false when the locator click throws", async () => {
    const page = {
      locator: vi.fn().mockReturnValue({
        first: () => ({ click: vi.fn().mockRejectedValue(new Error("not found")) }),
      }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as never;
    expect(await scriptedClickSelector(page, "#missing")).toBe(false);
  });
});
