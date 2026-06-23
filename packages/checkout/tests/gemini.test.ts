import { describe, it, expect } from "vitest";
import {
  buildGeminiRequest,
  parseGeminiResponse,
} from "../src/gemini.js";

describe("buildGeminiRequest", () => {
  it("lifts system messages into systemInstruction and maps roles", () => {
    const req = buildGeminiRequest([
      { role: "system", content: "You are a checkout agent." },
      { role: "user", content: "What button do I click?" },
      { role: "assistant", content: "The 'Buy now' button." },
      { role: "user", content: "Do it." },
    ]);

    expect(req.systemInstruction).toEqual({
      parts: [{ text: "You are a checkout agent." }],
    });
    // System message is excluded from the turn list; assistant becomes "model".
    expect(req.contents).toEqual([
      { role: "user", parts: [{ text: "What button do I click?" }] },
      { role: "model", parts: [{ text: "The 'Buy now' button." }] },
      { role: "user", parts: [{ text: "Do it." }] },
    ]);
    expect(req.generationConfig.temperature).toBe(0);
  });

  it("omits systemInstruction when there is no system message", () => {
    const req = buildGeminiRequest([{ role: "user", content: "hi" }]);
    expect(req.systemInstruction).toBeUndefined();
  });

  it("maps multimodal content: text part stays text, image data URL → inlineData", () => {
    const req = buildGeminiRequest([
      {
        role: "user",
        content: [
          { type: "text", text: "What do I click?" },
          {
            type: "image_url",
            image_url: { url: "data:image/jpeg;base64,QUJD" },
          },
        ],
      },
    ]);
    expect(req.contents).toEqual([
      {
        role: "user",
        parts: [
          { text: "What do I click?" },
          { inlineData: { mimeType: "image/jpeg", data: "QUJD" } },
        ],
      },
    ]);
  });

  it("maps json + temperature + maxTokens options", () => {
    const req = buildGeminiRequest([{ role: "user", content: "hi" }], {
      json: true,
      temperature: 0.7,
      maxTokens: 256,
    });
    expect(req.generationConfig.responseMimeType).toBe("application/json");
    expect(req.generationConfig.temperature).toBe(0.7);
    expect(req.generationConfig.maxOutputTokens).toBe(256);
  });
});

describe("parseGeminiResponse", () => {
  it("concatenates candidate parts into text", () => {
    const text = parseGeminiResponse({
      candidates: [{ content: { parts: [{ text: "click " }, { text: "buy" }] } }],
    });
    expect(text).toBe("click buy");
  });

  it("throws when the response carries no content", () => {
    expect(() => parseGeminiResponse({ candidates: [] })).toThrow(/no content/i);
  });
});
