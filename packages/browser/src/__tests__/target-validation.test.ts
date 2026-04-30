import { describe, expect, it } from "vitest";
import { isMalformedFrameScopedUid, isMalformedSelector, isMalformedUid } from "../target-validation.js";

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

describe("uid validation", () => {
  it("accepts frame IDs containing colons when the final segment is a node ID", () => {
    expect(isMalformedUid("https://example.test/frame:3")).toBe(false);
  });

  it("rejects non-numeric final uid segment", () => {
    expect(isMalformedUid("https://example.test/frame:notnum")).toBe(true);
  });

  it("rejects whitespace-bearing frame-scoped uid strings", () => {
    expect(isMalformedUid("main :1")).toBe(true);
    expect(isMalformedFrameScopedUid("main :1")).toBe(true);
  });

  it("rejects leading-zero node IDs", () => {
    expect(isMalformedUid("main:01")).toBe(true);
    expect(isMalformedFrameScopedUid("main:01")).toBe(true);
  });
});
