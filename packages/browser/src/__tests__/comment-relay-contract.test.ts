/**
 * comment-relay-contract.test.ts
 *
 * Tests for normalizeReadResult() and shapeRelayResponse() in:
 * packages/browser/src/comment-relay-contract.ts
 *
 * API checklist:
 * - normalizeReadResult(data: unknown): BrowserCommentReadEnvelope  [6 tests]
 * - shapeRelayResponse(action, result): BrowserRelayResponse        [4 tests]
 * - BrowserCommentReadEnvelope interface (mode parity)              [1 test]
 *
 * Requirement trace:
 * - BR-F-144: Read envelope must be { threads } — mode-invariant
 * - BR-F-145: Mutation notify semantics equivalent in both relay modes
 * - BR-F-146: Browser-extension tolerates legacy bare-array
 * - BR-F-122, BR-F-124, BR-F-130: (existing routing requirements)
 */

import { describe, it, expect } from "vitest";
import { normalizeReadResult, shapeRelayResponse } from "../comment-relay-contract.js";
import type { BrowserRelayCommentAction } from "../comment-relay-contract.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const canonicalEnvelope = {
  threads: [
    {
      id: "t1",
      anchor: {
        kind: "surface" as const,
        uri: "https://example.com/page",
        surfaceType: "browser",
        coordinates: { type: "normalized" as const, x: 0.5, y: 0.5 },
      },
      comments: [
        {
          id: "c1",
          threadId: "t1",
          createdAt: "2024-01-01T00:00:00.000Z",
          author: { kind: "user" as const, name: "Alice" },
          body: "Hello",
          anchor: {
            kind: "surface" as const,
            uri: "https://example.com/page",
            surfaceType: "browser",
            coordinates: { type: "normalized" as const, x: 0.5, y: 0.5 },
          },
          status: "open" as const,
        },
      ],
      status: "open" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      lastActivity: "2024-01-01T00:00:00.000Z",
    },
  ],
};

const legacyBareArray = [
  {
    id: "t1",
    anchor: {
      kind: "surface" as const,
      uri: "https://example.com/page",
      surfaceType: "browser",
      coordinates: { type: "normalized" as const, x: 0.5, y: 0.5 },
    },
    comments: [
      {
        id: "c1",
        threadId: "t1",
        createdAt: "2024-01-01T00:00:00.000Z",
        author: { kind: "user" as const, name: "Alice" },
        body: "Hello",
        anchor: {
          kind: "surface" as const,
          uri: "https://example.com/page",
          surfaceType: "browser",
          coordinates: { type: "normalized" as const, x: 0.5, y: 0.5 },
        },
        status: "open" as const,
      },
    ],
    status: "open" as const,
    createdAt: "2024-01-01T00:00:00.000Z",
    lastActivity: "2024-01-01T00:00:00.000Z",
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("normalizeReadResult", () => {
  it("BR-F-144-01: Given canonical { threads } envelope, returns it unchanged", () => {
    const result = normalizeReadResult(canonicalEnvelope);
    expect(result).toHaveProperty("threads");
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0]?.id).toBe("t1");
  });

  it("BR-F-144-02: Given bare array (legacy compat BR-F-146), still returns { threads } envelope", () => {
    const result = normalizeReadResult(legacyBareArray);
    expect(result).toHaveProperty("threads");
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0]?.id).toBe("t1");
  });

  it("BR-F-144-03: Given null, returns { threads: [] } without throwing", () => {
    const result = normalizeReadResult(null);
    expect(result).toEqual({ threads: [] });
  });

  it("BR-F-144-03: Given undefined, returns { threads: [] } without throwing", () => {
    const result = normalizeReadResult(undefined);
    expect(result).toEqual({ threads: [] });
  });

  it("BR-F-144-04: Given malformed { threads: null }, returns { threads: [] } defensively", () => {
    const result = normalizeReadResult({ threads: null } as unknown);
    expect(result).toEqual({ threads: [] });
  });

  it("BR-F-144-04: Given malformed { threads: 'bad' }, returns { threads: [] } defensively", () => {
    const result = normalizeReadResult({ threads: "bad" } as unknown);
    expect(result).toEqual({ threads: [] });
  });
});

describe("shapeRelayResponse", () => {
  it("BR-F-145-01: Wraps successful result with success: true, requestId, and correct data shape", () => {
    const result = shapeRelayResponse(
      "get_comments" as BrowserRelayCommentAction,
      { threads: [{ id: "t1", anchor: { kind: "surface", uri: "https://example.com/page", surfaceType: "browser", coordinates: { type: "normalized", x: 0.5, y: 0.5 } }, comments: [], status: "open", createdAt: "2024-01-01T00:00:00.000Z", lastActivity: "2024-01-01T00:00:00.000Z" }] },
    );
    expect(result).toHaveProperty("success", true);
    expect(result).toHaveProperty("requestId");
    expect(typeof result.requestId).toBe("string");
    expect(result.requestId.length).toBeGreaterThan(0);
    // Full success shape: data field must be present with the threads array
    expect(result).toHaveProperty("data");
    expect(result.data).toHaveProperty("threads");
    expect(Array.isArray(result.data.threads)).toBe(true);
  });

  it("BR-F-145-02: Wraps error result with success: false and exact error discriminator", () => {
    const result = shapeRelayResponse(
      "delete_thread" as BrowserRelayCommentAction,
      { error: "browser-not-connected" },
    );
    expect(result).toHaveProperty("success", false);
    expect(result).toHaveProperty("error", "browser-not-connected");
  });

  it("BR-F-145-03: Same action called twice produces distinct requestIds (non-idempotent)", () => {
    const result1 = shapeRelayResponse("resolve_thread" as BrowserRelayCommentAction, { threadId: "t1" });
    const result2 = shapeRelayResponse("resolve_thread" as BrowserRelayCommentAction, { threadId: "t1" });
    // Each call generates a fresh cryptographically random UUID — they must differ
    expect(result1.requestId).not.toBe(result2.requestId);
  });

  it("BR-F-145-03: Different actions produce distinct requestIds", () => {
    const id1 = shapeRelayResponse("get_comments" as BrowserRelayCommentAction, {}).requestId;
    const id2 = shapeRelayResponse("create_comment" as BrowserRelayCommentAction, {}).requestId;
    expect(id1).not.toBe(id2);
  });
});

describe("BR-F-144 mode parity integration", () => {
  // NOTE: This is a contract-level test using simulated fixtures, not an end-to-end
  // integration test exercising actual relay mode wiring. It validates that the
  // normalizeReadResult contract produces identical { threads } shapes regardless
  // of whether the input is a canonical envelope or a legacy bare array.
  it("BR-F-144-PARITY-01: normalizeReadResult produces identical { threads } shape from both relay modes", () => {
    // Simulate shared-relay output (returns bare array)
    const sharedRelayOutput = legacyBareArray;

    // Simulate per-window relay output (already canonical)
    const perWindowRelayOutput = canonicalEnvelope;

    const fromShared = normalizeReadResult(sharedRelayOutput);
    const fromPerWindow = normalizeReadResult(perWindowRelayOutput);

    // Both must return the same { threads } envelope shape
    expect(fromShared).toHaveProperty("threads");
    expect(fromPerWindow).toHaveProperty("threads");

    // Both should normalize the same way
    expect(fromShared.threads).toHaveLength(1);
    expect(fromPerWindow.threads).toHaveLength(1);
    expect(fromShared.threads[0]?.id).toBe(fromPerWindow.threads[0]?.id);
  });
});