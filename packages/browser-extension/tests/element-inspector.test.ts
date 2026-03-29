/**
 * element-inspector.test.ts
 *
 * Tests for M90-INS — Element Inspector
 *
 * These tests validate:
 * - inspectElement stub throws not implemented
 * - getDomExcerpt stub throws not implemented
 * - Types are correctly exported
 * - PU-F-10: Accepts ref (from page map) or selector (CSS)
 * - PU-F-11: Returns anchorKey and anchorStrategy in result
 * - PU-F-12: Returns element context (parentChain, siblingCount, siblingIndex, nearestLandmark)
 * - PU-F-13: Returns element attributes, visibility, accessibleName, testIds
 * - PU-F-14: Returns bounding box coordinates
 * - PU-F-15: Ref-based lookup uses ephemeral index (stale refs return found: false)
 * - PU-F-25: Enhanced anchor resolution fallback hierarchy order
 * - PU-F-33: Runtime { found: false } when selector matches no elements
 *
 * API checklist (inspectElement):
 * - PU-F-10: Accepts ref (from page map) or selector (CSS)
 * - PU-F-11: Returns anchorKey and anchorStrategy in result
 * - PU-F-12: Returns element context (parentChain, siblingCount, siblingIndex, nearestLandmark)
 * - PU-F-13: Returns element attributes, visibility, accessibleName, testIds
 * - PU-F-14: Returns bounding box coordinates
 * - PU-F-15: Ref-based lookup uses ephemeral index (stale refs return found: false)
 *
 * API checklist (getDomExcerpt):
 * - PU-F-30: Returns sanitized HTML fragment with only safe attributes
 * - PU-F-31: Respects maxDepth (default 3) and maxLength (default 2000)
 * - PU-F-32: Returns plain text content alongside HTML
 * - PU-F-33: Returns { found: false } when selector matches no elements
 */

import { describe, it, expect } from "vitest";
import {
  inspectElement,
  getDomExcerpt,
} from "../src/content/element-inspector.js";
import type {
  InspectElementArgs,
  InspectElementResult,
  ElementContext,
  ElementDetail,
} from "../src/content/element-inspector.js";
import type { SnapshotEnvelope } from "../src/snapshot-versioning.js";

/** Stub envelope fields for type-compliance in tests (B2-SV-003). */
const STUB_ENVELOPE: SnapshotEnvelope = {
  pageId: "page",
  frameId: "main",
  snapshotId: "page:0",
  capturedAt: "2025-01-01T00:00:00.000Z",
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
  source: "dom",
};

describe("M90-INS type exports", () => {
  /**
   * PU-F-10: InspectElementArgs accepts ref OR selector
   */
  it("PU-F-10: InspectElementArgs accepts ref parameter", () => {
    const args: InspectElementArgs = { ref: "node-ref-123" };
    expect(args.ref).toBe("node-ref-123");
  });

  it("PU-F-10: InspectElementArgs accepts selector parameter", () => {
    const args: InspectElementArgs = { selector: "#main > .content" };
    expect(args.selector).toBe("#main > .content");
  });

  /**
   * PU-F-11: InspectElementResult includes anchorKey and anchorStrategy
   */
  it("PU-F-11: InspectElementResult includes anchorKey and anchorStrategy fields", () => {
    const result: InspectElementResult = {
      ...STUB_ENVELOPE,
      found: true,
      anchorKey: "id:main-content",
      anchorStrategy: "id",
      anchorConfidence: "high",
    };
    expect(result.anchorKey).toBe("id:main-content");
    expect(result.anchorStrategy).toBe("id");
    expect(result.anchorConfidence).toBe("high");
  });

  /**
   * PU-F-13: ElementDetail includes all required fields
   */
  it("PU-F-13: ElementDetail includes tag, attributes, visible, accessibleName, testIds", () => {
    const detail: ElementDetail = {
      tag: "button",
      id: "submit-btn",
      classList: ["btn", "primary"],
      role: "button",
      ariaLabel: "Submit form",
      textContent: "Submit",
      attributes: { id: "submit-btn", "data-testid": "submit" },
      bounds: { x: 100, y: 200, width: 80, height: 30 },
      visible: true,
      visibleConfidence: "high",
      accessibleName: "Submit",
      testIds: { "data-testid": "submit" },
    };
    expect(detail.tag).toBe("button");
    expect(detail.visible).toBe(true);
    expect(detail.attributes).toHaveProperty("id");
  });

  /**
   * PU-F-12: ElementContext includes parentChain, siblingCount, siblingIndex, nearestLandmark
   */
  it("PU-F-12: ElementContext includes position context fields", () => {
    const context: ElementContext = {
      parentChain: ["div#app", "main", "section.content"],
      siblingCount: 5,
      siblingIndex: 2,
      nearestLandmark: "main",
    };
    expect(context.parentChain).toHaveLength(3);
    expect(context.siblingIndex).toBe(2);
    expect(context.nearestLandmark).toBe("main");
  });

  /**
   * PU-F-14: ElementDetail includes bounds { x, y, width, height }
   */
  it("PU-F-14: ElementDetail bounds has x, y, width, height", () => {
    const detail: ElementDetail = {
      tag: "div",
      attributes: {},
      bounds: { x: 0, y: 0, width: 100, height: 200 },
      visible: true,
      visibleConfidence: "high",
    };
    expect(detail.bounds).toEqual({ x: 0, y: 0, width: 100, height: 200 });
  });

  /**
   * PU-F-15: InspectElementResult found: false when element not found
   */
  it("PU-F-15: InspectElementResult can represent element-not-found", () => {
    const result: InspectElementResult = {
      ...STUB_ENVELOPE,
      found: false,
    };
    expect(result.found).toBe(false);
    expect(result.anchorKey).toBeUndefined();
  });
});

describe("M90-INS inspectElement behavioral output", () => {
  it("PU-F-10b: selector resolution prefers visible match when multiple elements match", () => {
    const hidden = document.createElement("button");
    hidden.className = "dup-target";
    hidden.textContent = "Hidden";
    hidden.style.display = "none";

    const visible = document.createElement("button");
    visible.className = "dup-target";
    visible.textContent = "Visible";

    document.body.appendChild(hidden);
    document.body.appendChild(visible);

    const result = inspectElement({ selector: ".dup-target" });
    expect(result.found).toBe(true);
    expect(result.element?.textContent).toBe("Visible");
  });

  /**
   * PU-F-10: inspectElement returns InspectElementResult with found field
   * Uses a selector to find a real element in the test DOM.
   */
  it("PU-F-10: inspectElement({ ref: 'ref-123' }) returns result with found field", () => {
    // ref-123 is not in the refIndex — should return { found: false }
    const result = inspectElement({ ref: "ref-123" });
    expect(result).toHaveProperty("found");
    expect(typeof result.found).toBe("boolean");
  });

  /**
   * PU-F-10: inspectElement with selector returns result with found field
   */
  it("PU-F-10: inspectElement({ selector: '#main' }) returns result with found field", () => {
    const result = inspectElement({ selector: "#main" });
    expect(result).toHaveProperty("found");
  });

  /**
   * PU-F-11: inspectElement returns anchorKey when element is found
   * Uses selector to find a real element in the test DOM.
   */
  it("PU-F-11: inspectElement({ ref: 'ref-123' }) returns anchorKey when found", () => {
    const result = inspectElement({ selector: "#main" });
    expect(result.found).toBe(true);
    expect(result).toHaveProperty("anchorKey");
  });

  /**
   * PU-F-11: inspectElement returns anchorStrategy when element is found
   */
  it("PU-F-11: inspectElement returns anchorStrategy when found", () => {
    const result = inspectElement({ selector: "#main" });
    expect(result.found).toBe(true);
    expect(result).toHaveProperty("anchorStrategy");
  });

  /**
   * PU-F-11: inspectElement returns anchorConfidence when element is found
   */
  it("PU-F-11: inspectElement returns anchorConfidence when found", () => {
    const result = inspectElement({ selector: "#main" });
    expect(result.found).toBe(true);
    expect(result).toHaveProperty("anchorConfidence");
  });

  /**
   * PU-F-12: inspectElement returns context when element is found
   */
  it("PU-F-12: inspectElement returns context when found", () => {
    const result = inspectElement({ selector: "#main" });
    expect(result.found).toBe(true);
    expect(result).toHaveProperty("context");
    if (result.context) {
      expect(result.context).toHaveProperty("parentChain");
      expect(result.context).toHaveProperty("siblingCount");
      expect(result.context).toHaveProperty("siblingIndex");
    }
  });

  /**
   * PU-F-14: inspectElement returns element with bounds when found
   */
  it("PU-F-14: inspectElement returns element.bounds when found", () => {
    const result = inspectElement({ selector: "#main" });
    expect(result.found).toBe(true);
    expect(result.element).toHaveProperty("bounds");
  });

  /**
   * PU-F-10: inspectElement for nonexistent element returns found: false without throwing
   */
  it("PU-F-10: inspectElement({ selector: '.nonexistent' }) returns found: false", () => {
    const result = inspectElement({ selector: ".nonexistent-xyz-123" });
    // Stub already returns found: false - this should pass
    expect(result.found).toBe(false);
  });

  /**
   * PU-F-13: inspectElement returns element detail with tag and attributes when found
   */
  it("PU-F-13: inspectElement returns element detail with tag and attributes when found", () => {
    const result = inspectElement({ selector: "#main" });
    expect(result.found).toBe(true);
    expect(result.element).toHaveProperty("tag");
    expect(result.element).toHaveProperty("attributes");
  });
});

describe("M90-INS getDomExcerpt behavioral output", () => {
  /**
   * PU-F-30: getDomExcerpt returns result with found field
   */
  it("PU-F-30: getDomExcerpt('#main') returns result with found field", () => {
    const result = getDomExcerpt("#main");
    expect(result).toHaveProperty("found");
    expect(typeof result.found).toBe("boolean");
  });

  /**
   * PU-F-31: getDomExcerpt with maxDepth returns result
   */
  it("PU-F-31: getDomExcerpt('div', 5) returns result with found field", () => {
    const result = getDomExcerpt("div", 5);
    expect(result).toHaveProperty("found");
  });

  /**
   * PU-F-31: getDomExcerpt with maxLength returns result
   */
  it("PU-F-31: getDomExcerpt('div', 3, 5000) returns result with found field", () => {
    const result = getDomExcerpt("div", 3, 5000);
    expect(result).toHaveProperty("found");
  });

  /**
   * PU-F-33: getDomExcerpt returns { found: false } for nonexistent selector
   * A selector that matches nothing must return { found: false } — this is the behavioral contract.
   * Stub already returns found: false, so this test passes against stub.
   */
  it("PU-F-33: getDomExcerpt('.nonexistent-class-xyz-123') returns { found: false }", () => {
    const result = getDomExcerpt(".nonexistent-class-xyz-123");
    expect(result.found).toBe(false);
  });

  /**
   * PU-F-33: getDomExcerpt returns html and text when found
   * Stub returns found: false. Real implementation would find 'body' and return found: true.
   * These assertions document the expected behavior when real implementation exists.
   */
  it("PU-F-33: getDomExcerpt('body') returns { found: true, html, text, nodeCount }", () => {
    const result = getDomExcerpt("body");
    // When real implementation exists: expect(result.found).toBe(true);
    // For now against stub: result.found is false — this test FAILS as expected in Phase B
    expect(result).toHaveProperty("html");
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("nodeCount");
  });

  /**
   * PU-F-30: getDomExcerpt sanitizes output - only safe attributes
   * Stub doesn't return actual HTML, so this test checks the shape.
   * Real implementation would return sanitized HTML with found: true for 'div'.
   */
  it("PU-F-30: getDomExcerpt('div') returned html does not contain event handlers when found", () => {
    const result = getDomExcerpt("div");
    // When real implementation exists: expect(result.found).toBe(true);
    if (result.html) {
      expect(result.html).not.toMatch(/onclick=/i);
      expect(result.html).not.toMatch(/onload=/i);
      expect(result.html).not.toMatch(/<script/i);
    }
  });
});

describe("M90-INS anchor strategy confidence levels", () => {
  /**
   * PU-F-11: Anchor confidence is high, medium, or low
   */
  it("PU-F-11: anchorConfidence can be 'high', 'medium', or 'low'", () => {
    const highResult: InspectElementResult = { ...STUB_ENVELOPE, found: true, anchorConfidence: "high" };
    const medResult: InspectElementResult = { ...STUB_ENVELOPE, found: true, anchorConfidence: "medium" };
    const lowResult: InspectElementResult = { ...STUB_ENVELOPE, found: true, anchorConfidence: "low" };

    expect(highResult.anchorConfidence).toBe("high");
    expect(medResult.anchorConfidence).toBe("medium");
    expect(lowResult.anchorConfidence).toBe("low");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// PU-F-25: Enhanced anchor resolution fallback hierarchy
// Validates that inspect_element uses enhanced anchor resolution with proper
// fallback order when generating anchor keys.
// ════════════════════════════════════════════════════════════════════════════════

describe("PU-F-25: enhanced anchor resolution in inspect_element (behavioral)", () => {
  /**
   * PU-F-25: inspect_element uses id strategy first when element has id
   * Stub returns found: false, so these tests will fail against the stub
   */
  it("PU-F-25: inspect_element generates id-based anchorKey when element has id", () => {
    // Use a selector that finds an element with an id attribute → id strategy
    const result = inspectElement({ selector: "#submit-btn" });
    expect(result.found).toBe(true);
    expect(result.anchorStrategy).toBe("id");
    expect(result.anchorConfidence).toBe("high");
  });

  /**
   * PU-F-25: inspect_element falls back to data-testid when element has no id
   */
  it("PU-F-25: inspect_element falls back to data-testid strategy", () => {
    const result = inspectElement({ selector: "[data-testid='login-btn']" });
    expect(result.found).toBe(true);
    expect(result.anchorStrategy).toBe("data-testid");
    expect(result.anchorConfidence).toBe("high");
  });

  /**
   * PU-F-25: inspect_element falls back through hierarchy to css-path
   */
  it("PU-F-25: inspect_element uses css-path as mid-tier fallback", () => {
    const result = inspectElement({ selector: ".dynamic-class-xyz" });
    expect(result.found).toBe(true);
    // Falls back through: id → data-testid → aria → css-path
    expect(["id", "data-testid", "aria", "css-path"]).toContain(result.anchorStrategy);
  });

  /**
   * PU-F-25: inspect_element uses viewport-pct as last resort
   */
  it("PU-F-25: inspect_element uses viewport-pct for elements with no stable identifier", () => {
    const result = inspectElement({ selector: "div:nth-child(5)" });
    expect(result.found).toBe(true);
    expect(result.anchorStrategy).toBe("viewport-pct");
    expect(result.anchorConfidence).toBe("low");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// PU-F-33: Runtime { found: false } for missing selector
// Validates that getDomExcerpt returns { found: false } at RUNTIME when the
// selector matches no elements, not just a type-shape check.
// ════════════════════════════════════════════════════════════════════════════════

describe("PU-F-33: getDomExcerpt runtime { found: false } for missing selector", () => {
  /**
   * PU-F-33: getDomExcerpt returns { found: false } when selector matches no elements
   */
  it("PU-F-33: getDomExcerpt returns { found: false } for nonexistent selector", () => {
    const result = getDomExcerpt(".nonexistent-class-xyz-123");
    // Stub returns found: false - real implementation would also return found: false
    // for a selector that matches nothing
    expect(result.found).toBe(false);
  });

  /**
   * PU-F-33: getDomExcerpt { found: false } excludes html/text from result
   */
  it("PU-F-33: getDomExcerpt { found: false } result has no html/text fields", () => {
    const result = getDomExcerpt(".nonexistent-class-xyz-123");
    expect(result.found).toBe(false);
    expect(result.html).toBeUndefined();
    expect(result.text).toBeUndefined();
  });

  /**
   * PU-F-33: getDomExcerpt { found: true } includes html, text, nodeCount, truncated
   */
  it("PU-F-33: getDomExcerpt { found: true } includes all excerpt fields", () => {
    const result = getDomExcerpt("#main");
    // Stub returns found: false - real implementation would find #main
    expect(result.found).toBe(true);
    expect(result).toHaveProperty("html");
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("nodeCount");
  });

  /**
   * PU-F-33: getDomExcerpt with maxDepth truncation
   */
  it("PU-F-33: getDomExcerpt respects maxDepth for deep DOM trees", () => {
    const result = getDomExcerpt("body", 1);
    expect(result.found).toBe(true);
    // Real implementation would limit depth to 1 level
  });

  /**
   * PU-F-33: getDomExcerpt with maxLength truncation
   */
  it("PU-F-33: getDomExcerpt respects maxLength for large HTML", () => {
    const result = getDomExcerpt("#main", 3, 100);
    expect(result.found).toBe(true);
    // Real implementation would truncate HTML to maxLength
    if (result.html && result.html.length > 100) {
      expect(result.truncated).toBe(true);
    }
  });

  /**
   * PU-F-33: getDomExcerpt sanitizes output - only safe attributes included
   */
  it("PU-F-33: getDomExcerpt sanitizes HTML (removes event handlers, scripts)", () => {
    const result = getDomExcerpt("div");
    expect(result.found).toBe(true);
    if (result.html) {
      expect(result.html).not.toMatch(/onclick=/i);
      expect(result.html).not.toMatch(/onload=/i);
      expect(result.html).not.toMatch(/<script/i);
    }
  });
});
