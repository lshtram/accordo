import { describe, expect, it } from "vitest";
import { isMalformedSelector } from "../target-validation.js";

describe("target validation is environment-safe", () => {
  it("returns false for selector validation when document is unavailable", () => {
    const originalDocument = (globalThis as any).document;
    Reflect.deleteProperty(globalThis as any, "document");
    try {
      expect(isMalformedSelector("div[")).toBe(false);
    } finally {
      (globalThis as any).document = originalDocument;
    }
  });
});
