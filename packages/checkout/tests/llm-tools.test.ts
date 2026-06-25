import { describe, it, expect } from "vitest";
import { parseToolCompletion, parseToolArgs } from "../src/llm.js";
import type { ToolCall } from "../src/llm.js";

describe("parseToolCompletion()", () => {
  it("extracts free text and tool calls from an OpenAI-style message", () => {
    const out = parseToolCompletion({
      content: "let me click that",
      tool_calls: [
        { id: "c1", function: { name: "click", arguments: '{"ref":3}' } },
        { id: "c2", function: { name: "scroll", arguments: '{"direction":"down"}' } },
      ],
    });
    expect(out.text).toBe("let me click that");
    expect(out.toolCalls).toHaveLength(2);
    expect(out.toolCalls[0]).toEqual({ id: "c1", name: "click", arguments: '{"ref":3}' });
    expect(out.toolCalls[1].name).toBe("scroll");
  });

  it("handles a null content (tool-only turn)", () => {
    const out = parseToolCompletion({
      content: null,
      tool_calls: [{ id: "c1", function: { name: "finish", arguments: "{}" } }],
    });
    expect(out.text).toBe("");
    expect(out.toolCalls).toHaveLength(1);
  });

  it("skips malformed calls with no function name", () => {
    const out = parseToolCompletion({
      content: "",
      tool_calls: [
        { id: "c1", function: { arguments: "{}" } },
        { id: "c2", function: { name: "press", arguments: '{"key":"Enter"}' } },
      ],
    });
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0].name).toBe("press");
  });

  it("synthesizes an id when the provider omits one", () => {
    const out = parseToolCompletion({
      tool_calls: [{ function: { name: "click", arguments: "{}" } }],
    });
    expect(out.toolCalls[0].id).toBe("call_0");
  });

  it("returns empty completion for an absent message", () => {
    expect(parseToolCompletion(undefined)).toEqual({ text: "", toolCalls: [] });
  });
});

describe("parseToolArgs()", () => {
  const call = (arguments_: string): ToolCall => ({ id: "c", name: "t", arguments: arguments_ });

  it("parses a valid JSON object", () => {
    expect(parseToolArgs(call('{"x":10,"y":20}'))).toEqual({ x: 10, y: 20 });
  });

  it("returns {} for empty arguments", () => {
    expect(parseToolArgs(call(""))).toEqual({});
    expect(parseToolArgs(call("   "))).toEqual({});
  });

  it("returns {} for malformed JSON", () => {
    expect(parseToolArgs(call("{not json"))).toEqual({});
  });

  it("returns {} for a non-object JSON value", () => {
    expect(parseToolArgs(call("42"))).toEqual({});
    expect(parseToolArgs(call('"hi"'))).toEqual({});
  });
});
