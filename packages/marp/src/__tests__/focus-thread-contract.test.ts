/**
 * focus-thread-contract.test.ts — Tests for Marp focus-thread contract
 *
 * Requirements covered:
 *   M50-FOCUS-06  normalizeDeckUriToFsPath — URI vs fsPath normalization for focus/open decisions
 *   M50-PVD-18    isValidSlideIndex — slide index validation (negative, NaN, out-of-range → invalid)
 *   M50-FOCUS-06  buildPresentationFocusThreadPlan — canonical focus plan building
 *
 * Test naming: R-<requirement>-<NN>
 */

import { describe, it, expect } from "vitest";
import {
  normalizeDeckUriToFsPath,
  parseSlideIndex,
  isValidSlideIndex,
  buildPresentationFocusThreadPlan,
  toVsCodeUri,
  type PresentationFocusThreadRequest,
} from "../focus-thread-contract.js";

// API checklist:
// ✓ normalizeDeckUriToFsPath()  — R-FOCUS-06 (3 tests)
// ✓ parseSlideIndex()            — R-PVD-18 (3 tests)
// ✓ isValidSlideIndex()          — R-PVD-18 (4 tests)
// ✓ buildPresentationFocusThreadPlan() — R-FOCUS-06 (3 tests)
// ✓ toVsCodeUri()               — R-FOCUS-06 (2 tests)

// ── R-FOCUS-06: normalizeDeckUriToFsPath ─────────────────────────────────────

describe("R-FOCUS-06: normalizeDeckUriToFsPath", () => {
  it("R-FOCUS-06-01: file:///path/to/deck.md normalizes to absolute fsPath", () => {
    // A file:// URI must normalize to the same fsPath as the same deck opened directly.
    const uri = "file:///home/user/project/deck.md";
    const result = normalizeDeckUriToFsPath(uri);
    // The result must be an absolute path string (no file:// scheme).
    expect(result).toMatch(/^\/[^\s]/); // absolute path, not a URI string
    expect(result).not.toContain("file://");
    expect(result).toContain("deck.md");
  });

  it("R-FOCUS-06-02: fsPath normalizes to the same value (idempotent)", () => {
    const fsPath = "/home/user/project/deck.md";
    const result = normalizeDeckUriToFsPath(fsPath);
    expect(result).toBe(fsPath);
  });

  it("R-FOCUS-06-03: file:/// and fsPath forms of the same deck resolve to equal paths", () => {
    // The core invariant: equivalent deck references must normalize to identical paths.
    const uriForm = "file:///home/user/project/deck.md";
    const fsPathForm = "/home/user/project/deck.md";
    expect(normalizeDeckUriToFsPath(uriForm)).toBe(normalizeDeckUriToFsPath(fsPathForm));
  });
});

// ── R-PVD-18 / R-FOCUS-06: parseSlideIndex ─────────────────────────────────────

describe("R-PVD-18: parseSlideIndex", () => {
  it("R-PVD-18-01: parses valid slide blockId to index", () => {
    // Format: slide:{idx}:{x}:{y}
    const result = parseSlideIndex("slide:3:0.5000:0.5000");
    expect(result).toBe(3);
  });

  it("R-PVD-18-02: returns null for non-slide blockId", () => {
    const result = parseSlideIndex("block:abc123");
    expect(result).toBeNull();
  });

  it("R-PVD-18-03: returns null for malformed slide blockId (missing fields)", () => {
    const result = parseSlideIndex("slide:3");
    expect(result).toBeNull();
  });
});

// ── R-PVD-18: isValidSlideIndex ───────────────────────────────────────────────

describe("R-PVD-18: isValidSlideIndex", () => {
  it("R-PVD-18-04: valid 0-based index within bounds returns true", () => {
    // Slide count of 5 means valid indices are 0–4.
    expect(isValidSlideIndex(0, 5)).toBe(true);
    expect(isValidSlideIndex(2, 5)).toBe(true);
    expect(isValidSlideIndex(4, 5)).toBe(true);
  });

  it("R-PVD-18-05: negative index returns false (does not throw)", () => {
    // M50-PVD-18: invalid indices must no-op without throwing.
    // Negative index must return false, NOT crash.
    expect(isValidSlideIndex(-1, 5)).toBe(false);
    expect(isValidSlideIndex(-100, 5)).toBe(false);
  });

  it("R-PVD-18-06: NaN returns false (does not throw)", () => {
    expect(isValidSlideIndex(NaN, 5)).toBe(false);
  });

  it("R-PVD-18-07: out-of-range index returns false (does not throw)", () => {
    // Index equal to slideCount is out of range (0-based, so 5 slides → max index 4).
    expect(isValidSlideIndex(5, 5)).toBe(false);
    expect(isValidSlideIndex(100, 5)).toBe(false);
  });

  it("R-PVD-18-08: Infinity returns false (does not throw)", () => {
    expect(isValidSlideIndex(Infinity, 5)).toBe(false);
    expect(isValidSlideIndex(-Infinity, 5)).toBe(false);
  });
});

// ── R-FOCUS-06: buildPresentationFocusThreadPlan ────────────────────────────────

describe("R-FOCUS-06: buildPresentationFocusThreadPlan", () => {
  it("R-FOCUS-06-04: given same deck uri and currentDeckUri, shouldOpenDeck is false", () => {
    // M50-FOCUS-06: canonically-equal deck references must not force closeSession+reopen.
    const request: PresentationFocusThreadRequest = {
      requestedDeckUri: "file:///home/user/deck.md",
      currentDeckUri: "file:///home/user/deck.md",
      threadId: "thread-1",
      blockId: "slide:0:0.5:0.5",
    };
    const plan = buildPresentationFocusThreadPlan(request);
    expect(plan.shouldOpenDeck).toBe(false);
  });

  it("R-FOCUS-06-05: given different URI forms of the same deck, shouldOpenDeck is false", () => {
    // Normalization must handle file:// vs fsPath divergence.
    const request: PresentationFocusThreadRequest = {
      requestedDeckUri: "file:///home/user/deck.md",
      currentDeckUri: "/home/user/deck.md",
      threadId: "thread-1",
      blockId: "slide:2:0.5000:0.5000",
    };
    const plan = buildPresentationFocusThreadPlan(request);
    // The normalized URIs are equal, so no reopen is needed.
    expect(plan.shouldOpenDeck).toBe(false);
  });

  it("R-FOCUS-06-06: focusMessage type is 'comments:focus' with correct threadId and blockId", () => {
    const request: PresentationFocusThreadRequest = {
      requestedDeckUri: "/deck.md",
      currentDeckUri: null,
      threadId: "thread-42",
      blockId: "slide:1:0.2500:0.7500",
    };
    const plan = buildPresentationFocusThreadPlan(request);
    expect(plan.focusMessage).toEqual({
      type: "comments:focus",
      threadId: "thread-42",
      blockId: "slide:1:0.2500:0.7500",
    });
  });
});

// ── R-FOCUS-06: toVsCodeUri ───────────────────────────────────────────────────

describe("R-FOCUS-06: toVsCodeUri", () => {
  it("R-FOCUS-06-07: converts file:/// URI to vscode.Uri with correct fsPath", () => {
    const result = toVsCodeUri("file:///home/user/deck.md");
    expect(result.fsPath).toContain("deck.md");
  });

  it("R-FOCUS-06-08: converts fsPath to vscode.Uri with matching fsPath", () => {
    const fsPath = "/home/user/deck.md";
    const result = toVsCodeUri(fsPath);
    expect(result.fsPath).toBe(fsPath);
  });
});
