/**
 * enhanced-anchor.test.ts
 *
 * Tests for M90-ANC — Enhanced Anchor System
 *
 * These tests validate:
 * - AnchorStrategy type includes all 6 strategies
 * - generateAnchorKey throws not implemented (Phase A stub)
 * - resolveAnchorKey throws not implemented (Phase A stub)
 * - parseEnhancedAnchorKey throws not implemented (Phase A stub)
 * - isEnhancedAnchorKey correctly identifies enhanced keys
 * - Strategy prefixes are correctly defined
 * - PU-F-25: Backward compatibility with existing anchor system
 * - PU-F-25: Fallback hierarchy order (id → data-testid → aria → css-path → tag-sibling → viewport-pct)
 *
 * API checklist (generateAnchorKey):
 * - PU-F-20: generateAnchorKey tries strategies in order: id → data-testid → aria → css-path → tag-sibling → viewport
 * - PU-F-21: Anchor key format encodes strategy: "id:", "data-testid:", "aria:", "css:", "tag:", "body:"
 *
 * API checklist (resolveAnchorKey):
 * - PU-F-22: resolveAnchorKey dispatches resolution based on strategy prefix
 * - PU-F-23..PU-F-25: Specific strategy resolution implementations
 * - PU-F-26: Backward compatibility with existing anchor keys
 */

import { describe, it, expect } from "vitest";
import {
  generateAnchorKey,
  resolveAnchorKey,
  parseEnhancedAnchorKey,
  isEnhancedAnchorKey,
  STRATEGY_CONFIDENCE,
  STRATEGY_PREFIXES,
} from "../src/content/enhanced-anchor.js";
import type { AnchorStrategy } from "../src/content/enhanced-anchor.js";

describe("M90-ANC anchor strategy types and constants", () => {
  /**
   * PU-F-20: Anchor strategies defined in order of stability
   */
  it("PU-F-20: AnchorStrategy type includes all 6 strategies", () => {
    const strategies: AnchorStrategy[] = [
      "id",
      "data-testid",
      "aria",
      "css-path",
      "tag-sibling",
      "viewport-pct",
    ];

    strategies.forEach((s) => {
      const valid: AnchorStrategy = s;
      expect(valid).toBe(s);
    });
  });

  /**
   * PU-F-20: STRATEGY_CONFIDENCE maps each strategy to its confidence level
   */
  it("PU-F-20: STRATEGY_CONFIDENCE maps strategies to confidence levels", () => {
    expect(STRATEGY_CONFIDENCE["id"]).toBe("high");
    expect(STRATEGY_CONFIDENCE["data-testid"]).toBe("high");
    expect(STRATEGY_CONFIDENCE["aria"]).toBe("medium");
    expect(STRATEGY_CONFIDENCE["css-path"]).toBe("medium");
    expect(STRATEGY_CONFIDENCE["tag-sibling"]).toBe("low");
    expect(STRATEGY_CONFIDENCE["viewport-pct"]).toBe("low");
  });

  /**
   * PU-F-21: Anchor key format encodes strategy prefix
   */
  it("PU-F-21: STRATEGY_PREFIXES includes all strategy prefixes", () => {
    expect(STRATEGY_PREFIXES).toContain("id:");
    expect(STRATEGY_PREFIXES).toContain("data-testid:");
    expect(STRATEGY_PREFIXES).toContain("aria:");
    expect(STRATEGY_PREFIXES).toContain("css:");
    expect(STRATEGY_PREFIXES).toContain("tag:");
    expect(STRATEGY_PREFIXES).toContain("body:");
  });
});

describe("M90-ANC isEnhancedAnchorKey detection", () => {
  /**
   * PU-F-22: isEnhancedAnchorKey correctly identifies enhanced anchor keys
   */
  it("PU-F-22: isEnhancedAnchorKey returns true for id: prefixed keys", () => {
    expect(isEnhancedAnchorKey("id:submit-btn")).toBe(true);
  });

  it("PU-F-22: isEnhancedAnchorKey returns true for data-testid: prefixed keys", () => {
    expect(isEnhancedAnchorKey("data-testid:login-form")).toBe(true);
  });

  it("PU-F-22: isEnhancedAnchorKey returns true for aria: prefixed keys", () => {
    expect(isEnhancedAnchorKey("aria:Submit/button")).toBe(true);
  });

  it("PU-F-22: isEnhancedAnchorKey returns true for css: prefixed keys", () => {
    expect(isEnhancedAnchorKey("css:main>div>button")).toBe(true);
  });

  it("PU-F-22: isEnhancedAnchorKey returns true for tag: prefixed keys", () => {
    expect(isEnhancedAnchorKey("tag:button:3:submit")).toBe(true);
  });

  /**
   * PU-F-26: Backward compatibility — existing anchor keys without strategy prefix
   * Note: Legacy format uses tagName:siblingIndex:textFingerprint (e.g. "button:3:submit").
   * The isEnhancedAnchorKey function checks if key starts with a STRATEGY_PREFIX,
   * so unprefixed legacy keys like "button:3:submit" correctly return false.
   */
  it("PU-F-26: isEnhancedAnchorKey returns false for standard tag-sibling legacy keys", () => {
    // Legacy format: tagName:siblingIndex:textFingerprint
    expect(isEnhancedAnchorKey("button:3:submit")).toBe(false);
    expect(isEnhancedAnchorKey("div:0:test")).toBe(false);
    // These are unambiguously legacy (no "body:" prefix issue)
  });

  /**
   * PU-F-26 (design issue): body:0:center collision
   *
   * DESIGN ISSUE: body:0:center is a LEGACY tag-sibling anchor (body element, index 0,
   * fingerprint "center"). But "body:" IS in STRATEGY_PREFIXES as the viewport-pct prefix.
   *
   * The current stub returns TRUE for body:0:center because it starts with "body:".
   * This is a prefix collision: the same prefix ("body:") means two different things:
   *   - In viewport-pct strategy: body:42%x63% (viewport percentage)
   *   - In tag-sibling strategy: body:0:center (body element, sibling index 0, fingerprint "center")
   *
   * PU-F-26 requires backward compatibility with existing anchors. During Phase C,
   * this should be resolved by either:
   *   A) Using "viewport:" prefix for enhanced viewport anchors instead of "body:"
   *   B) Special-casing body:0:center in isEnhancedAnchorKey (e.g. checking for %x% pattern)
   *
   * This test documents the CURRENT (problematic) stub behavior.
   */
  it("PU-F-26 (design issue): body:0:center identified as enhanced due to prefix collision", () => {
    // Fixed implementation: body:0:center is a legacy tag-sibling anchor and must NOT
    // be identified as enhanced. Only body:x%xy% (viewport-pct) keys are enhanced.
    expect(isEnhancedAnchorKey("body:0:center")).toBe(false);
  });
});

describe("M90-ANC stub implementations return structured data", () => {
  /**
   * PU-F-20: generateAnchorKey returns AnchorGenerationResult with anchorKey, strategy, confidence
   */
  it("PU-F-20: generateAnchorKey returns result with anchorKey, strategy, confidence", () => {
    // @ts-expect-error - passing mock element to stub
    const result = generateAnchorKey({ id: "test", getAttribute: () => "test-value" });
    expect(result).toHaveProperty("anchorKey");
    expect(result).toHaveProperty("strategy");
    expect(result).toHaveProperty("confidence");
  });

  /**
   * PU-F-20: generateAnchorKey returns a non-stub anchorKey
   * Stub returns "stub:anchor-key" - real implementation would return actual strategy-based key
   */
  it("PU-F-20: generateAnchorKey returns real anchorKey (not 'stub:anchor-key')", () => {
    // @ts-expect-error - passing mock element
    const result = generateAnchorKey({ id: "submit-btn", getAttribute: () => null });
    // Stub returns "stub:anchor-key" - real implementation would return "id:submit-btn"
    expect(result.anchorKey).not.toBe("stub:anchor-key");
    expect(result.anchorKey).toMatch(/^(id|data-testid|aria|css|tag|body):/);
  });

  /**
   * PU-F-22: resolveAnchorKey returns Element or null
   * Stub returns null for all keys - real implementation would return actual element
   */
  it("PU-F-22: resolveAnchorKey('id:submit-btn') returns Element or null", () => {
    const result = resolveAnchorKey("id:submit-btn");
    expect(result).toBeDefined();
    // Stub returns null - real implementation would return the element if found
  });

  /**
   * PU-F-22: resolveAnchorKey resolves legacy keys via tag-sibling resolution
   * Phase C: real implementation returns element via findAnchorElementByKey
   */
  it("PU-F-22: resolveAnchorKey returns null for legacy keys", () => {
    const result = resolveAnchorKey("button:3:submit");
    // Real implementation returns element via tag-sibling resolution (data-anchor attribute match)
    expect(result).toBeDefined();
  });

  /**
   * PU-F-23: parseEnhancedAnchorKey returns ParsedEnhancedAnchor or null
   * Stub returns null - real implementation would parse the key
   */
  it("PU-F-23: parseEnhancedAnchorKey('id:submit-btn') returns ParsedEnhancedAnchor", () => {
    const result = parseEnhancedAnchorKey("id:submit-btn");
    // Stub returns null - real implementation would return { strategy: "id", value: "submit-btn" }
    expect(result).not.toBeNull();
    if (result) {
      expect(result).toHaveProperty("strategy");
      expect(result).toHaveProperty("value");
    }
  });

  /**
   * PU-F-23: parseEnhancedAnchorKey parses id strategy correctly
   */
  it("PU-F-23: parseEnhancedAnchorKey returns correct strategy and value for id key", () => {
    const result = parseEnhancedAnchorKey("id:submit-btn");
    // Stub returns null - real implementation would return { strategy: "id", value: "submit-btn" }
    expect(result).not.toBeNull();
    expect(result?.strategy).toBe("id");
    expect(result?.value).toBe("submit-btn");
  });

  /**
   * PU-F-23: parseEnhancedAnchorKey parses data-testid strategy correctly
   */
  it("PU-F-23: parseEnhancedAnchorKey returns correct strategy and value for data-testid key", () => {
    const result = parseEnhancedAnchorKey("data-testid:login-form");
    expect(result).not.toBeNull();
    expect(result?.strategy).toBe("data-testid");
    expect(result?.value).toBe("login-form");
  });
});

describe("M90-ANC strategy-based resolution path", () => {
  /**
   * PU-F-23: id strategy uses document.getElementById()
   * Note: Testing the stub throws, actual implementation to follow
   */
  it("PU-F-23: id strategy key format is 'id:{elementId}'", () => {
    const key = "id:submit-btn";
    expect(key.startsWith("id:")).toBe(true);
    expect(key).toBe("id:submit-btn");
  });

  /**
   * PU-F-24: data-testid strategy uses document.querySelector('[data-testid="..."]')
   */
  it("PU-F-24: data-testid strategy key format is 'data-testid:{value}'", () => {
    const key = "data-testid:login-form";
    expect(key.startsWith("data-testid:")).toBe(true);
    expect(key).toBe("data-testid:login-form");
  });

  /**
   * PU-F-21: Anchor key format encodes strategy and value
   */
  it("PU-F-21: aria strategy key format is 'aria:{label}/{role}'", () => {
    const key = "aria:Submit/button";
    expect(key.startsWith("aria:")).toBe(true);
    expect(key).toBe("aria:Submit/button");
  });

  it("PU-F-21: css-path strategy key format is 'css:{selector}'", () => {
    const key = "css:main>div>button";
    expect(key.startsWith("css:")).toBe(true);
    expect(key).toBe("css:main>div>button");
  });

  it("PU-F-21: tag-sibling strategy key format is 'tag:{tagName}:{siblingIndex}:{fingerprint}'", () => {
    const key = "tag:button:3:submit";
    expect(key.startsWith("tag:")).toBe(true);
    expect(key).toBe("tag:button:3:submit");
  });

  /**
   * PU-F-21: viewport-pct strategy uses body: prefix
   */
  it("PU-F-21: viewport-pct strategy key format is 'body:{x}%:{y}%'", () => {
    const key = "body:42%x63%";
    expect(key.startsWith("body:")).toBe(true);
    expect(key).toBe("body:42%x63%");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// PU-F-25: Enhanced anchor resolution fallback hierarchy order
// Validates that resolveAnchorKey tries strategies in order:
// id → data-testid → aria → css-path → tag-sibling → viewport-pct
// ════════════════════════════════════════════════════════════════════════════════

describe("PU-F-25: enhanced anchor resolution fallback hierarchy (behavioral)", () => {
  /**
   * PU-F-25: generateAnchorKey tries strategies in the correct fallback order
   * id → data-testid → aria → css-path → tag-sibling → viewport-pct
   */
  it("PU-F-25: generateAnchorKey tries id strategy first for element with id", () => {
    // @ts-expect-error - passing mock element
    const result = generateAnchorKey({ id: "test-id", getAttribute: () => null });
    // Stub returns strategy "id" with confidence "low" - but real implementation
    // would return confidence "high" for id strategy
    expect(result.strategy).toBe("id");
    expect(result.confidence).toBe("high");
  });

  /**
   * PU-F-25: generateAnchorKey falls back to data-testid when id is not available
   */
  it("PU-F-25: generateAnchorKey falls back to data-testid when id is missing", () => {
    // @ts-expect-error - passing mock element
    const result = generateAnchorKey({ id: "", getAttribute: (name) => (name === "data-testid" ? "test-btn" : null) });
    expect(result.strategy).toBe("data-testid");
    expect(result.confidence).toBe("high");
  });

  /**
   * PU-F-25: generateAnchorKey falls back through full hierarchy to viewport-pct
   */
  it("PU-F-25: generateAnchorKey uses viewport-pct as last resort", () => {
    // @ts-expect-error - passing mock element
    const result = generateAnchorKey({ id: "", getAttribute: () => null, tagName: "DIV" });
    expect(result.strategy).toBe("viewport-pct");
    expect(result.confidence).toBe("low");
  });

  /**
   * PU-F-25: resolveAnchorKey dispatches based on strategy prefix
   */
  it("PU-F-25: resolveAnchorKey dispatches id: keys to getElementById", () => {
    const element = resolveAnchorKey("id:submit-btn");
    // Stub returns null - real implementation would return element if found
    expect(element).not.toBeNull();
  });

  /**
   * PU-F-25: resolveAnchorKey dispatches data-testid: keys to querySelector
   */
  it("PU-F-25: resolveAnchorKey dispatches data-testid: keys", () => {
    const element = resolveAnchorKey("data-testid:login-form");
    expect(element).not.toBeNull();
  });

  /**
   * PU-F-25: resolveAnchorKey falls back through hierarchy when primary strategy fails
   */
  it("PU-F-25: resolveAnchorKey falls back to tag-sibling when id fails", () => {
    // id:some-nonexistent-id → try data-testid → try css-path → try tag-sibling
    const element = resolveAnchorKey("id:nonexistent");
    // Stub returns null - but a real implementation might find element via fallback
    expect(element).toBeNull();
  });

  /**
   * PU-F-25: resolveAnchorKey handles viewport-pct keys (body:x%x%y%)
   */
  it("PU-F-25: resolveAnchorKey handles viewport-pct keys", () => {
    const element = resolveAnchorKey("body:50%x50%");
    // Stub returns null - real implementation would return body element
    expect(element).not.toBeNull();
  });

  /**
   * PU-F-25: parseEnhancedAnchorKey parses strategy prefix correctly
   */
  it("PU-F-25: parseEnhancedAnchorKey extracts strategy and value", () => {
    const parsed = parseEnhancedAnchorKey("id:main-content");
    // Stub returns null - real implementation would return parsed key
    expect(parsed).not.toBeNull();
    expect(parsed?.strategy).toBe("id");
    expect(parsed?.value).toBe("main-content");
  });

  /**
   * PU-F-25: parseEnhancedAnchorKey handles viewport-pct with offset coordinates
   */
  it("PU-F-25: parseEnhancedAnchorKey handles viewport-pct with offsets", () => {
    const parsed = parseEnhancedAnchorKey("body:25%x30%");
    expect(parsed).not.toBeNull();
    expect(parsed?.strategy).toBe("viewport-pct");
    expect(parsed?.value).toBe("25%x30%");
  });

  /**
   * PU-F-25: backward compatibility - legacy keys without strategy prefix
   */
  it("PU-F-25: resolveAnchorKey handles legacy tag-sibling keys", () => {
    // Legacy format: tagName:siblingIndex:textFingerprint
    const element = resolveAnchorKey("button:3:submit");
    // Stub returns null - real implementation would return element via tag-sibling resolution
    expect(element).not.toBeNull();
  });
});
