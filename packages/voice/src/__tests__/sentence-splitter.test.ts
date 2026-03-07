/**
 * M50-SS — SentenceSplitter tests (Phase B — must FAIL before implementation)
 * Coverage: M50-SS-01 through M50-SS-06
 */

import { describe, it, expect } from "vitest";
import { splitIntoSentences } from "../text/sentence-splitter.js";

describe("splitIntoSentences", () => {
  it("M50-SS-01: exported function exists", () => {
    expect(typeof splitIntoSentences).toBe("function");
  });

  it("M50-SS-05: empty string returns empty array", () => {
    expect(splitIntoSentences("")).toEqual([]);
  });

  it("M50-SS-05: whitespace-only returns empty array", () => {
    expect(splitIntoSentences("   \n\n  ")).toEqual([]);
  });

  it("M50-SS-02: splits on period + whitespace", () => {
    const result = splitIntoSentences("Hello world. Goodbye world.");
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toContain("Hello world");
    expect(result[1]).toContain("Goodbye world");
  });

  it("M50-SS-02: splits on exclamation mark", () => {
    const result = splitIntoSentences("Wow! That is great!");
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("M50-SS-02: splits on question mark", () => {
    const result = splitIntoSentences("Is this working? Yes it is.");
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("M50-SS-03: splits on newlines", () => {
    const result = splitIntoSentences("First line\nSecond line");
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toContain("First line");
  });

  it("M50-SS-04: trims each fragment and filters empty strings", () => {
    const result = splitIntoSentences("  Hello.  \n  World.  ");
    for (const s of result) {
      expect(s).toBe(s.trim());
      expect(s.length).toBeGreaterThan(0);
    }
  });
});
