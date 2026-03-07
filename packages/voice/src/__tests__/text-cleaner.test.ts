/**
 * M50-TC — TextCleaner tests (Phase B — must FAIL before implementation)
 * Coverage: M50-TC-01 through M50-TC-17
 */

import { describe, it, expect } from "vitest";
import { cleanTextForNarration } from "../text/text-cleaner.js";

describe("cleanTextForNarration", () => {
  const full = (text: string): string => cleanTextForNarration(text, "narrate-full");
  const headings = (text: string): string => cleanTextForNarration(text, "narrate-headings");

  // M50-TC-01 + M50-TC-17: function exists and is pure
  it("M50-TC-01: exported function exists", () => {
    expect(typeof cleanTextForNarration).toBe("function");
  });

  // M50-TC-03: fenced code blocks
  it("M50-TC-03: fenced code block → description", () => {
    const text = "Here is code:\n```\nconst x = 1;\n```\nAnd done.";
    const result = full(text);
    expect(result).toContain("There's a code snippet shown on screen.");
    expect(result).not.toContain("const x");
  });

  it("M50-TC-03: fenced code block with language tag → description", () => {
    const text = "```typescript\nconst x = 1;\n```";
    expect(full(text)).toContain("There's a code snippet shown on screen.");
  });

  // M50-TC-04: inline code
  it("M50-TC-04: short inline code (≤20 chars) → keeps content", () => {
    const text = "Use `foo.bar()` to call it.";
    expect(full(text)).toContain("foo.bar()");
  });

  it("M50-TC-04: long inline code (>20 chars) → 'a code reference'", () => {
    const text = "Use `veryLongFunctionNameHere123()` to call it.";
    expect(full(text)).toContain("a code reference");
    expect(full(text)).not.toContain("veryLongFunctionNameHere123");
  });

  // M50-TC-05: math expressions
  it("M50-TC-05: inline math $...$ → description", () => {
    const text = "The formula is $E = mc^2$ here.";
    expect(full(text)).toContain("There's a mathematical expression shown on screen.");
    expect(full(text)).not.toContain("mc^2");
  });

  it("M50-TC-05: block math $$...$$ → description", () => {
    const text = "$$\\sum_{i=0}^{n} i$$";
    expect(full(text)).toContain("There's a mathematical expression shown on screen.");
  });

  // M50-TC-06: URLs
  it("M50-TC-06: bare URL → 'there's a link shown on screen'", () => {
    const text = "See https://example.com/page for details.";
    expect(full(text)).toContain("there's a link shown on screen");
    expect(full(text)).not.toContain("https://");
  });

  // M50-TC-07: markdown links
  it("M50-TC-07: markdown link [text](url) → keeps text, strips URL", () => {
    const text = "Click [here](https://example.com) to continue.";
    const result = full(text);
    expect(result).toContain("here");
    expect(result).not.toContain("https://example.com");
  });

  // M50-TC-08: bold/italic markers
  it("M50-TC-08: bold **text** → text preserved, markers stripped", () => {
    expect(full("This is **important** text.")).toContain("important");
    expect(full("This is **important** text.")).not.toContain("**");
  });

  it("M50-TC-08: italic _text_ → text preserved, markers stripped", () => {
    expect(full("This is _italicized_ text.")).toContain("italicized");
    expect(full("This is _italicized_ text.")).not.toContain("_italicized_");
  });

  // M50-TC-09: HTML tags
  it("M50-TC-09: HTML tags are stripped entirely", () => {
    const text = "<p>Hello <strong>world</strong></p>";
    const result = full(text);
    expect(result).toContain("Hello");
    expect(result).toContain("world");
    expect(result).not.toContain("<p>");
    expect(result).not.toContain("<strong>");
  });

  // M50-TC-10: headings
  it("M50-TC-10: heading # → 'Section: Heading'", () => {
    const text = "# Introduction";
    expect(full(text)).toContain("Section: Introduction");
  });

  it("M50-TC-10: ## heading → 'Section: Subheading'", () => {
    const text = "## Getting Started";
    expect(full(text)).toContain("Section: Getting Started");
  });

  // M50-TC-11: bullet markers
  it("M50-TC-11: dash bullet stripped", () => {
    const text = "- First item\n- Second item";
    const result = full(text);
    expect(result).toContain("First item");
    expect(result).not.toMatch(/^-\s/m);
  });

  // M50-TC-12: emoji
  it("M50-TC-12: emoji stripped", () => {
    const text = "Hello 🎉 world 🚀";
    const result = full(text);
    expect(result).not.toContain("🎉");
    expect(result).not.toContain("🚀");
    expect(result).toContain("Hello");
    expect(result).toContain("world");
  });

  // M50-TC-14: whitespace collapse
  it("M50-TC-14: multiple spaces collapsed to one", () => {
    expect(full("Hello    world")).not.toMatch(/  /);
  });

  // M50-TC-15: narrate-headings mode
  it("M50-TC-15: narrate-headings extracts heading + first sentence only", () => {
    const text = "## Setup\nInstall the package. Then configure it. More details.\n## Usage\nRun the command.";
    const result = headings(text);
    expect(result).toContain("Setup");
    expect(result).toContain("Install the package");
    // Should NOT include "Then configure it" (second sentence after heading)
    expect(result).not.toContain("More details");
  });

  // M50-TC-16: empty input
  it("M50-TC-16: empty string → empty string", () => {
    expect(full("")).toBe("");
  });

  it("M50-TC-16: whitespace-only → trimmed (empty or minimal)", () => {
    expect(full("   \n   ").trim()).toBe("");
  });
});
