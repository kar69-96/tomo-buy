import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCuaTask } from "../src/cua/loop.js";

// These specs exercise the tool-calling loop with an injected model/observe.
// runCuaTask routes to the native Anthropic path when ANTHROPIC_API_KEY is set
// (vitest.config loads .env), so pin tool-calling mode for this suite.
beforeEach(() => {
  vi.stubEnv("CUA_MODE", "tool-calling");
});
afterEach(() => {
  vi.unstubAllEnvs();
});
import type { Observation } from "../src/cua/loop.js";
import type { CuaTool, ToolContext } from "../src/cua/tools.js";
import type { ToolCompletion, ChatMessage, ToolDef } from "../src/llm.js";

// A fake page good enough for the loop's post-round pageSignature() call.
function fakePage(sig: { url: string; elCount: number }): any {
  return {
    url: () => sig.url,
    viewportSize: () => ({ width: 1280, height: 900 }),
    waitForTimeout: async () => {},
    evaluate: async () => ({ url: sig.url, title: "", elCount: sig.elCount, visInputs: 0, visDialogs: 0 }),
  };
}

function obs(url: string, elCount: number): Observation {
  return { text: "elements", image: null, signature: { url, title: "", elCount, visInputs: 0, visDialogs: 0 } };
}

// Scripts a model from a fixed sequence of completions.
function scriptModel(seq: ToolCompletion[]) {
  let i = 0;
  const calls: ChatMessage[][] = [];
  const fn = vi.fn(async (messages: ChatMessage[], _tools: ToolDef[]) => {
    calls.push(messages);
    return seq[Math.min(i++, seq.length - 1)];
  });
  return { fn, calls };
}

function tool(name: string, run: CuaTool["run"]): CuaTool {
  return { def: { name, description: name, parameters: { type: "object", properties: {} } }, run };
}

const ctx = (page: any): ToolContext => ({
  page, context: {} as any, variables: {}, cdpCreds: {}, domain: "x.test", log: () => {},
  shippingData: { email: "", firstName: "", lastName: "", street: "", apartment: "", city: "", state: "", zip: "", country: "", phone: "" },
});

const call = (name: string, args = "{}", id = "c1") => ({ id, name, arguments: args });

describe("runCuaTask — control flow", () => {
  it("returns the finish result when the model calls finish", async () => {
    const finishTool = tool("finish", async (_c, a) => ({
      text: "finish", finish: { status: "confirmation" as const, orderNumber: a.order_number as string, total: a.total as string },
    }));
    const model = scriptModel([
      { text: "", toolCalls: [call("finish", '{"status":"confirmation","order_number":"A1","total":"$9"}')] },
    ]);
    const res = await runCuaTask({
      objective: "buy it",
      tools: [finishTool],
      toolContext: ctx(fakePage({ url: "http://t/", elCount: 100 })),
      model: model.fn,
      observe: async () => obs("http://t/", 100),
    });
    expect(res.status).toBe("confirmation");
    expect(res.orderNumber).toBe("A1");
    expect(res.total).toBe("$9");
    expect(res.toolCalls).toBe(1);
  });

  it("executes a tool and feeds its result back, then finishes", async () => {
    const clickRun = vi.fn(async () => ({ text: "click: done — the page advanced." }));
    const tools = [
      tool("click", clickRun),
      tool("finish", async () => ({ text: "finish", finish: { status: "parked_payment" as const } })),
    ];
    const model = scriptModel([
      { text: "", toolCalls: [call("click", '{"ref":3}')] },
      { text: "", toolCalls: [call("finish")] },
    ]);
    const res = await runCuaTask({
      objective: "go",
      tools,
      toolContext: ctx(fakePage({ url: "http://t/", elCount: 100 })),
      model: model.fn,
      // url changes each call so the click round counts as advancement (no stall)
      observe: (() => { let n = 0; return async () => obs(`http://t/${n++}`, 100); })(),
    });
    expect(clickRun).toHaveBeenCalledWith(expect.anything(), { ref: 3 });
    expect(res.status).toBe("parked_payment");
    // a tool message carrying the click result must have been sent on the 2nd model call
    const second = model.calls[1];
    expect(second.some((m) => m.role === "tool" && m.content === "click: done — the page advanced.")).toBe(true);
  });

  it("stops after STALL_LIMIT rounds with no page advancement", async () => {
    const noop = tool("wait", async () => ({ text: "wait" }));
    // model always calls the noop tool; observe + page report the SAME signature → no advance
    const model = scriptModel([{ text: "", toolCalls: [call("wait")] }]);
    const res = await runCuaTask({
      objective: "spin",
      tools: [noop],
      toolContext: ctx(fakePage({ url: "http://t/", elCount: 100 })),
      model: model.fn,
      observe: async () => obs("http://t/", 100),
    });
    expect(res.status).toBe("stopped");
    expect(res.note).toBe("no progress");
    expect(res.rounds).toBe(6); // STALL_LIMIT
  });

  it("stops when the model issues no tool calls (idle)", async () => {
    const model = scriptModel([{ text: "I'm thinking", toolCalls: [] }]);
    const res = await runCuaTask({
      objective: "noop",
      tools: [tool("finish", async () => ({ text: "f", finish: { status: "stopped" as const } }))],
      toolContext: ctx(fakePage({ url: "http://t/", elCount: 100 })),
      model: model.fn,
      observe: async () => obs("http://t/", 100),
    });
    expect(res.status).toBe("stopped");
    expect(res.note).toMatch(/no tool calls/);
    expect(res.rounds).toBe(2); // IDLE_LIMIT
  });

  it("honors the maxToolCalls budget when the page keeps advancing", async () => {
    const go = tool("go", async () => ({ text: "go" }));
    const model = scriptModel([{ text: "", toolCalls: [call("go")] }]);
    const res = await runCuaTask({
      objective: "loop",
      tools: [go],
      toolContext: ctx(fakePage({ url: "http://t/", elCount: 100 })),
      model: model.fn,
      maxToolCalls: 3,
      // distinct url each round → advancement → stall never triggers, budget governs
      observe: (() => { let n = 0; return async () => obs(`http://t/${n++}`, 100); })(),
    });
    expect(res.status).toBe("stopped");
    expect(res.note).toMatch(/budget/);
    expect(res.toolCalls).toBe(3);
  });

  it("survives an unknown tool name and keeps going", async () => {
    const model = scriptModel([
      { text: "", toolCalls: [call("bogus")] },
      { text: "", toolCalls: [call("finish")] },
    ]);
    const res = await runCuaTask({
      objective: "x",
      tools: [tool("finish", async () => ({ text: "f", finish: { status: "error" as const, note: "done" } }))],
      toolContext: ctx(fakePage({ url: "http://t/", elCount: 100 })),
      model: model.fn,
      observe: (() => { let n = 0; return async () => obs(`http://t/${n++}`, 100); })(),
    });
    expect(res.status).toBe("error");
    const second = model.calls[1];
    expect(second.some((m) => m.role === "tool" && String(m.content).includes("unknown tool"))).toBe(true);
  });

  it("intervenes on a repeated dead action: forces a scroll + corrective, then continues", async () => {
    const scrolled = { n: 0 };
    const page = fakePage({ url: "http://t/", elCount: 100 });
    page.evaluate = async () => { scrolled.n++; return { url: "http://t/", title: "", elCount: 100, visInputs: 0, visDialogs: 0 }; };
    // A click tool that always fails to land (ok:false), then finish.
    const deadClick = tool("click", async () => ({ ok: false, text: "click (640,820): did not land. Re-aim or try another control." }));
    const finishTool = tool("finish", async () => ({ text: "f", finish: { status: "stopped" as const } }));
    // Model fires the SAME dead click twice (triggers the guard), then finishes.
    const model = scriptModel([
      { text: "", toolCalls: [call("click", '{"x":640,"y":820}')] },
      { text: "", toolCalls: [call("click", '{"x":640,"y":820}')] },
      { text: "", toolCalls: [call("finish")] },
    ]);
    const res = await runCuaTask({
      objective: "x",
      tools: [deadClick, finishTool],
      toolContext: ctx(page),
      model: model.fn,
      observe: async () => obs("http://t/", 100),
    });
    expect(res.status).toBe("stopped");
    // The 3rd model call must have received the forceful corrective in a user turn.
    const third = model.calls[2];
    const corrective = third.find(
      (m) => m.role === "user" && JSON.stringify(m.content).includes("keeps failing"),
    );
    expect(corrective).toBeTruthy();
  });

  it("groups jittered coordinate clicks: near-identical x,y still trips the vision corrective", async () => {
    const page = fakePage({ url: "http://t/", elCount: 100 });
    // A vision click that never advances (ok:false), then finish.
    const deadClick = tool("click", async () => ({ ok: false, text: "click: no visible change." }));
    const finishTool = tool("finish", async () => ({ text: "f", finish: { status: "stopped" as const } }));
    // Two clicks 1px apart — DIFFERENT raw args, but quantized to the same target.
    const model = scriptModel([
      { text: "", toolCalls: [call("click", '{"x":818,"y":438}')] },
      { text: "", toolCalls: [call("click", '{"x":818,"y":439}')] },
      { text: "", toolCalls: [call("finish")] },
    ]);
    const res = await runCuaTask({
      objective: "x",
      tools: [deadClick, finishTool],
      toolContext: ctx(page),
      model: model.fn,
      observe: async () => obs("http://t/", 100),
    });
    expect(res.status).toBe("stopped");
    // The 3rd model call must have received the corrective steering it to vision.
    const third = model.calls[2];
    const corrective = third.find(
      (m) => m.role === "user" && JSON.stringify(m.content).includes("keeps failing"),
    );
    expect(corrective).toBeTruthy();
  });

  it("returns error when the model call throws", async () => {
    const res = await runCuaTask({
      objective: "x",
      tools: [tool("finish", async () => ({ text: "f", finish: { status: "stopped" as const } }))],
      toolContext: ctx(fakePage({ url: "http://t/", elCount: 100 })),
      model: async () => { throw new Error("boom"); },
      observe: async () => obs("http://t/", 100),
    });
    expect(res.status).toBe("error");
    expect(res.note).toMatch(/model call failed/);
  });
});
