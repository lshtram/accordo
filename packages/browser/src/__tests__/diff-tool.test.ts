/**
 * M101-DIFF — diff-tool.test.ts
 *
 * Tests for M101-DIFF — browser_diff_snapshots MCP Tool (B2-DE-001..B2-DE-007).
 *
 * Tests the browser package's diff-tool.ts:
 * - B2-DE-001: Tool registered with correct metadata (name, dangerLevel, idempotent)
 * - B2-DE-003: Implicit `to` — captures fresh snapshot when toSnapshotId is omitted
 * - B2-DE-004: Implicit `from` — uses previous snapshot when fromSnapshotId is omitted
 * - B2-DE-006: Returns snapshot-not-found error for missing snapshots
 * - B2-DE-007: Returns snapshot-stale error for pre-navigation snapshots
 *
 * The browser_diff_snapshots tool forwards requests through the relay to the
 * Chrome extension's service worker where the diff engine runs.
 *
 * API checklist (buildDiffSnapshotsTool):
 * - browser_diff_snapshots → registered, dangerLevel: "safe", idempotent: true
 *
 * API checklist (handleDiffSnapshots):
 * - handleDiffSnapshots  → B2-DE-001, B2-DE-003, B2-DE-004, B2-DE-006, B2-DE-007
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HIGHER-FIDELITY TESTING NOTES (M101 B2 Review)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The standard mock (createMockRelay) is LENIENT — it resolves implicit IDs
 * for you when the handler fails to do so. Tests using it for B2-DE-003/004
 * are FALSE-GREEN: they pass even when the handler has no implicit logic.
 *
 * The strict mock (createStrictRelay) returns an error when either ID is
 * undefined, which more closely mirrors real relay behavior where the Chrome
 * service worker expects explicit snapshot IDs.
 *
 * Higher-fidelity RED tests use a recording relay (createRecordingRelay) that
 * captures the exact payload sent to the relay and asserts the handler
 * correctly resolved implicit IDs BEFORE calling relay.request(). These tests
 * fail at assertion level when the handler passes undefined values through.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildDiffSnapshotsTool,
  handleDiffSnapshots,
  DiffSnapshotsArgs,
  DiffSnapshotsResponse,
  DiffToolError,
} from "../diff-tool.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import type { BrowserRelayLike } from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEnvelope(pageId: string, version: number) {
  return {
    pageId,
    frameId: "main",
    snapshotId: `${pageId}:${version}`,
    capturedAt: `2025-01-01T00:00:0${version}.000Z`,
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    source: "dom" as const,
  };
}

function makeDiffResponse(
  fromSnapshotId: string,
  toSnapshotId: string,
  added: Array<{ nodeId: number; tag: string; text?: string }> = [],
  removed: Array<{ nodeId: number; tag: string; text?: string }> = [],
  changed: Array<{ nodeId: number; tag: string; field: string; before: string; after: string }> = []
): DiffSnapshotsResponse {
  return {
    ...makeEnvelope("page-diff", 99),
    fromSnapshotId,
    toSnapshotId,
    added,
    removed,
    changed,
    summary: {
      addedCount: added.length,
      removedCount: removed.length,
      changedCount: changed.length,
      textDelta: `${added.length} added, ${removed.length} removed, ${changed.length} changed`,
    },
  };
}

// ── Lenient Mock Relay ────────────────────────────────────────────────────────

/**
 * Lenient mock relay — returns valid responses for any input.
 * DO NOT use for B2-DE-003/004 implicit snapshot tests — it fabricates
 * implicit IDs and produces FALSE-GREEN results.
 *
 * Use for: structural tests (B2-DE-001, B2-DE-002, B2-DE-005, B2-DE-006, B2-DE-007).
 */
function createMockRelay(overrides?: {
  success?: boolean;
  data?: unknown;
  errorAction?: string;
}) {
  return {
    request: vi.fn().mockImplementation(async (_action: string, payload?: Record<string, unknown>) => {
      if (overrides?.errorAction === "snapshot-not-found") {
        return {
          success: false,
          requestId: "test",
          data: { error: "snapshot-not-found" },
        };
      }
      if (overrides?.errorAction === "snapshot-stale") {
        return {
          success: false,
          requestId: "test",
          data: { error: "snapshot-stale" },
        };
      }
      if (overrides?.errorAction === "action-failed") {
        return {
          success: false,
          requestId: "test",
          error: "action-failed",
        };
      }

      const diffResponse = makeDiffResponse(
        (payload?.fromSnapshotId as string) ?? "page-auto:9",
        (payload?.toSnapshotId as string) ?? "page-auto:10",
        [{ nodeId: 2, tag: "div", text: "New div" }],
        [],
        []
      );

      return {
        success: true,
        requestId: "test",
        data: overrides?.data ?? diffResponse,
      };
    }),
    isConnected: vi.fn(() => true),
  } as unknown as BrowserRelayLike;
}

// ── Strict Mock Relay ─────────────────────────────────────────────────────────

/**
 * Strict mock relay — enforces semantic contracts around implicit snapshot logic.
 *
 * Returns success ONLY when the handler provides explicit snapshot IDs.
 * If either ID is undefined, returns "implicit-snapshot-resolution-required".
 *
 * This is the correct mock for verifying that the handler implements B2-DE-003
 * and B2-DE-004: the handler must resolve implicit IDs BEFORE calling relay,
 * not rely on the relay to fill them in.
 */
function createStrictRelay() {
  return {
    request: vi.fn().mockImplementation(async (_action: string, payload?: Record<string, unknown>) => {
      const fromId = payload?.fromSnapshotId as string | undefined;
      const toId = payload?.toSnapshotId as string | undefined;

      // Strict contract: both IDs must be explicitly provided
      if (fromId === undefined || toId === undefined) {
        return {
          success: false,
          requestId: "test",
          data: { error: "implicit-snapshot-resolution-required" },
        };
      }

      // Verify semantic ordering: to must be newer than from
      const fromVersion = parseInt(fromId.split(":")[1] ?? "-1", 10);
      const toVersion = parseInt(toId.split(":")[1] ?? "-1", 10);

      if (toVersion <= fromVersion) {
        return {
          success: false,
          requestId: "test",
          data: { error: "invalid-snapshot-ordering" },
        };
      }

      return {
        success: true,
        requestId: "test",
        data: makeDiffResponse(
          fromId,
          toId,
          [{ nodeId: 2, tag: "div", text: "New div" }],
          [],
          []
        ),
      };
    }),
    isConnected: vi.fn(() => true),
  } as unknown as BrowserRelayLike;
}

// ── Recording Relay (Higher-Fidelity Testing) ──────────────────────────────────

/**
 * Recording relay for higher-fidelity implicit snapshot testing.
 *
 * Records the exact payload passed to relay.request() and returns a success
 * response. Use this to verify the handler correctly resolved implicit IDs
 * BEFORE the relay call — not to verify the relay fills them in.
 *
 * B2-DE-003 RED test: when toSnapshotId is omitted, the handler MUST call
 *   relay with an explicit resolved toSnapshotId (not undefined).
 *   Assertion: recordedPayload.toSnapshotId !== undefined
 *
 * B2-DE-004 RED test: when fromSnapshotId is omitted, the handler MUST call
 *   relay with an explicit resolved fromSnapshotId (not undefined).
 *   Assertion: recordedPayload.fromSnapshotId !== undefined
 */
function createRecordingRelay() {
  let recordedPayload: Record<string, unknown> = {};

  const relay = {
    request: vi.fn().mockImplementation(async (_action: string, payload?: Record<string, unknown>) => {
      recordedPayload = { ...(payload ?? {}) };
      return {
        success: true,
        requestId: "test",
        data: makeDiffResponse(
          (recordedPayload.fromSnapshotId as string) ?? "page-rec:9",
          (recordedPayload.toSnapshotId as string) ?? "page-rec:10",
          [{ nodeId: 2, tag: "div", text: "New div" }],
          [],
          []
        ),
      };
    }),
    isConnected: vi.fn(() => true),
    getRecordedPayload: () => recordedPayload,
    resetRecordedPayload: () => { recordedPayload = {}; },
  } as unknown as BrowserRelayLike & {
    getRecordedPayload(): Record<string, unknown>;
    resetRecordedPayload(): void;
  };

  return relay;
}

// ── B2-DE-001: Diff tool exists with correct metadata ─────────────────────────

describe("B2-DE-001: browser_diff_snapshots tool registration", () => {
  /**
   * B2-DE-001: Tool appears in MCP tool registry with name 'browser_diff_snapshots'
   */
  it("B2-DE-001: buildDiffSnapshotsTool returns a tool with name 'browser_diff_snapshots'", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tools = [buildDiffSnapshotsTool(relay, store)];

    expect(Array.isArray(tools)).toBe(true);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("browser_diff_snapshots");
  });

  /**
   * B2-DE-001: Tool is registered with dangerLevel: "safe" and idempotent: true
   */
  it("B2-DE-001: tool has dangerLevel: 'safe' and idempotent: true", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tools = [buildDiffSnapshotsTool(relay, store)];

    expect(tools[0]!.dangerLevel).toBe("safe");
    expect(tools[0]!.idempotent).toBe(true);
  });

  /**
   * B2-DE-001: Tool has inputSchema with fromSnapshotId and toSnapshotId properties
   */
  it("B2-DE-001: tool inputSchema includes fromSnapshotId and toSnapshotId properties", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tools = [buildDiffSnapshotsTool(relay, store)];

    expect(tools[0]!.inputSchema.properties).toHaveProperty("fromSnapshotId");
    expect(tools[0]!.inputSchema.properties).toHaveProperty("toSnapshotId");
  });

  /**
   * B2-DE-001: handler function is present and callable
   */
  it("B2-DE-001: tool has a handler function", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tools = [buildDiffSnapshotsTool(relay, store)];

    expect(typeof tools[0]!.handler).toBe("function");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B2-DE-003: Implicit `to` Snapshot — Higher-Fidelity RED Tests
//
// The handler MUST resolve toSnapshotId BEFORE calling relay.request().
// These tests use a recording relay to verify the exact payload sent.
// ═══════════════════════════════════════════════════════════════════════════════

describe("B2-DE-003: implicit `to` snapshot — RED test: handler must resolve toSnapshotId before calling relay", () => {
  /**
   * B2-DE-003 RED: When toSnapshotId is omitted, the handler MUST call relay
   * with an EXPLICITLY RESOLVED toSnapshotId — not undefined.
   *
   * Current behavior FAILS this test because the handler passes
   * { toSnapshotId: undefined } directly to relay instead of resolving it.
   *
   * Assertion: recordedPayload.toSnapshotId !== undefined
   */
  it("B2-DE-003 RED: handler calls relay with resolved toSnapshotId (not undefined) when omitted", async () => {
    const relay = createRecordingRelay();
    const store = new SnapshotRetentionStore();

    // Call with only fromSnapshotId — toSnapshotId is undefined
    await handleDiffSnapshots(relay, { fromSnapshotId: "page-001:0" }, store);

    // RECORDING RELAY ASSERTION: The handler must have called relay with
    // an explicitly resolved toSnapshotId, not undefined.
    // Currently FAILS because handler passes args directly without resolution.
    const payload = (relay as ReturnType<typeof createRecordingRelay>).getRecordedPayload();
    expect(payload.toSnapshotId).not.toBeUndefined();
    expect(typeof payload.toSnapshotId).toBe("string");
    expect((payload.toSnapshotId as string).length).toBeGreaterThan(0);
  });

  /**
   * B2-DE-003 RED: When toSnapshotId is omitted, the resolved toSnapshotId
   * must be semantically newer than fromSnapshotId (version ordering).
   *
   * Current behavior FAILS because handler passes undefined.
   */
  it("B2-DE-003 RED: resolved toSnapshotId must be newer than fromSnapshotId", async () => {
    const relay = createRecordingRelay();
    const store = new SnapshotRetentionStore();

    await handleDiffSnapshots(relay, { fromSnapshotId: "page-002:5" }, store);

    const payload = (relay as ReturnType<typeof createRecordingRelay>).getRecordedPayload();
    const fromId = payload.fromSnapshotId as string;
    const toId = payload.toSnapshotId as string;

    // Both must be defined and ordered
    expect(fromId).toBeDefined();
    expect(toId).toBeDefined();

    const fromVersion = parseInt(fromId.split(":")[1] ?? "-1", 10);
    const toVersion = parseInt(toId.split(":")[1] ?? "-1", 10);
    expect(toVersion).toBeGreaterThan(fromVersion);
  });

  /**
   * B2-DE-003 RED (strict mock path): When handler fails to resolve implicit
   * toSnapshotId and passes undefined to relay, the strict relay returns
   * "implicit-snapshot-resolution-required".
   *
   * Current behavior FAILS this test because the handler converts the specific
   * error to generic "action-failed" at line 229 of diff-tool.ts.
   *
   * Assertion: error.error === "implicit-snapshot-resolution-required"
   */
  it("B2-DE-003 RED: strict mock — error must preserve 'implicit-snapshot-resolution-required' not 'action-failed'", async () => {
    const strictRelay = createStrictRelay();
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(strictRelay, { fromSnapshotId: "page-strict:0" }, store);

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;

    // The handler must preserve the specific error from the strict relay,
    // not collapse it into generic "action-failed".
    // Currently FAILS: handler returns "action-failed" (line 229 catch-all)
    expect(error.error).toBe("implicit-snapshot-resolution-required");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B2-DE-004: Implicit `from` Snapshot — Higher-Fidelity RED Tests
//
// The handler MUST resolve fromSnapshotId BEFORE calling relay.request().
// These tests use a recording relay to verify the exact payload sent.
// ═══════════════════════════════════════════════════════════════════════════════

describe("B2-DE-004: implicit `from` snapshot — RED test: handler must resolve fromSnapshotId before calling relay", () => {
  /**
   * B2-DE-004 RED: When fromSnapshotId is omitted, the handler MUST call relay
   * with an EXPLICITLY RESOLVED fromSnapshotId — not undefined.
   *
   * Current behavior FAILS this test because the handler passes
   * { fromSnapshotId: undefined } directly to relay instead of resolving it.
   *
   * Assertion: recordedPayload.fromSnapshotId !== undefined
   */
  it("B2-DE-004 RED: handler calls relay with resolved fromSnapshotId (not undefined) when omitted", async () => {
    const relay = createRecordingRelay();
    const store = new SnapshotRetentionStore();

    // Call with only toSnapshotId — fromSnapshotId is undefined
    await handleDiffSnapshots(relay, { toSnapshotId: "page-003:5" }, store);

    // RECORDING RELAY ASSERTION: The handler must have called relay with
    // an explicitly resolved fromSnapshotId, not undefined.
    // Currently FAILS because handler passes args directly without resolution.
    const payload = (relay as ReturnType<typeof createRecordingRelay>).getRecordedPayload();
    expect(payload.fromSnapshotId).not.toBeUndefined();
    expect(typeof payload.fromSnapshotId).toBe("string");
    expect((payload.fromSnapshotId as string).length).toBeGreaterThan(0);
  });

  /**
   * B2-DE-004 RED: When fromSnapshotId is omitted, the resolved fromSnapshotId
   * must be semantically older than toSnapshotId (version ordering).
   *
   * Current behavior FAILS because handler passes undefined.
   */
  it("B2-DE-004 RED: resolved fromSnapshotId must be older than toSnapshotId", async () => {
    const relay = createRecordingRelay();
    const store = new SnapshotRetentionStore();

    await handleDiffSnapshots(relay, { toSnapshotId: "page-004:3" }, store);

    const payload = (relay as ReturnType<typeof createRecordingRelay>).getRecordedPayload();
    const fromId = payload.fromSnapshotId as string;
    const toId = payload.toSnapshotId as string;

    // Both must be defined and ordered
    expect(fromId).toBeDefined();
    expect(toId).toBeDefined();

    const fromVersion = parseInt(fromId.split(":")[1] ?? "-1", 10);
    const toVersion = parseInt(toId.split(":")[1] ?? "-1", 10);
    expect(fromVersion).toBeLessThan(toVersion);
  });

  /**
   * B2-DE-004 RED (strict mock path): When handler fails to resolve implicit
   * fromSnapshotId and passes undefined to relay, the strict relay returns
   * "implicit-snapshot-resolution-required".
   *
   * Current behavior FAILS this test because the handler converts the specific
   * error to generic "action-failed" at line 229 of diff-tool.ts.
   *
   * Assertion: error.error === "implicit-snapshot-resolution-required"
   */
  it("B2-DE-004 RED: strict mock — error must preserve 'implicit-snapshot-resolution-required' not 'action-failed'", async () => {
    const strictRelay = createStrictRelay();
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(strictRelay, { toSnapshotId: "page-strict:5" }, store);

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;

    // The handler must preserve the specific error from the strict relay,
    // not collapse it into generic "action-failed".
    // Currently FAILS: handler returns "action-failed" (line 229 catch-all)
    expect(error.error).toBe("implicit-snapshot-resolution-required");
  });
});

// ── B2-DE-006: Diff error for missing snapshot ─────────────────────────────────

describe("B2-DE-006: snapshot-not-found error for missing snapshots", () => {
  it("B2-DE-006: returns { success: false, error: 'snapshot-not-found' } for unknown snapshot", async () => {
    const relay = createMockRelay({ errorAction: "snapshot-not-found" });
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(relay, { fromSnapshotId: "unknown:99", toSnapshotId: "unknown:100" }, store);

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    expect(error.error).toBe("snapshot-not-found");
  });

  it("B2-DE-006: snapshot-not-found error for pruned snapshot (evicted from 5-slot store)", async () => {
    const relay = createMockRelay({ errorAction: "snapshot-not-found" });
    const store = new SnapshotRetentionStore();

    // Simulate calling with a snapshot that was evicted (pruned)
    const result = await handleDiffSnapshots(relay, { fromSnapshotId: "page-005:0", toSnapshotId: "page-005:10" }, store);

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    expect(error.error).toBe("snapshot-not-found");
  });
});

// ── B2-DE-007: Diff error for stale snapshot ───────────────────────────────────

describe("B2-DE-007: snapshot-stale error for pre-navigation snapshots", () => {
  it("B2-DE-007: returns { success: false, error: 'snapshot-stale' } for pre-navigation snapshot", async () => {
    const relay = createMockRelay({ errorAction: "snapshot-stale" });
    const store = new SnapshotRetentionStore();

    // Simulate calling with a snapshot from before navigation
    const result = await handleDiffSnapshots(relay, { fromSnapshotId: "page-006:0", toSnapshotId: "page-006:1" }, store);

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    expect(error.error).toBe("snapshot-stale");
  });

  it("B2-DE-007: after navigation, requesting pre-navigation snapshot returns snapshot-stale", async () => {
    const relay = createMockRelay({ errorAction: "snapshot-stale" });
    const store = new SnapshotRetentionStore();

    // Page navigated, now requesting old pre-navigation snapshot
    const result = await handleDiffSnapshots(relay, { fromSnapshotId: "old-session:0", toSnapshotId: "old-session:1" }, store);

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    expect(error.error).toBe("snapshot-stale");
  });
});

// ── B2-DE-002: Explicit from/to — diff between two specific snapshots ─────────

describe("B2-DE-002: explicit from/to — diff between two specific snapshots", () => {
  it("B2-DE-002: when both IDs provided, uses those exact snapshots", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(
      relay,
      { fromSnapshotId: "page-007:1", toSnapshotId: "page-007:3" },
      store
    );

    expect(relay.request).toHaveBeenCalledWith(
      "diff_snapshots",
      expect.objectContaining({
        fromSnapshotId: "page-007:1",
        toSnapshotId: "page-007:3",
      }),
      expect.any(Number)
    );

    // Result is DiffSnapshotsResponse on success
    const diffResult = result as DiffSnapshotsResponse;
    expect(diffResult.fromSnapshotId).toBe("page-007:1");
    expect(diffResult.toSnapshotId).toBe("page-007:3");
  });

  it("B2-DE-002: diff result includes added, removed, changed arrays", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(
      relay,
      { fromSnapshotId: "page-008:0", toSnapshotId: "page-008:2" },
      store
    );

    // Result is DiffSnapshotsResponse on success
    const diffResult = result as DiffSnapshotsResponse;
    expect(Array.isArray(diffResult.added)).toBe(true);
    expect(Array.isArray(diffResult.removed)).toBe(true);
    expect(Array.isArray(diffResult.changed)).toBe(true);
  });

  it("B2-DE-002: strict mock — explicit IDs pass through correctly", async () => {
    /**
     * Higher-fidelity test path: When both IDs are explicitly provided,
     * the strict mock should also pass (no implicit resolution needed).
     */
    const strictRelay = createStrictRelay();
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(
      strictRelay,
      { fromSnapshotId: "page-007:1", toSnapshotId: "page-007:3" },
      store
    );

    // With explicit IDs, the strict mock should succeed
    expect(result).not.toHaveProperty("success", false);
    const diffResult = result as DiffSnapshotsResponse;
    expect(diffResult.fromSnapshotId).toBe("page-007:1");
    expect(diffResult.toSnapshotId).toBe("page-007:3");
  });
});

// ── B2-DE-005: Diff summary ───────────────────────────────────────────────────

describe("B2-DE-005: diff result includes summary with counts matching arrays", () => {
  it("B2-DE-005: summary.addedCount matches added.length", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(
      relay,
      { fromSnapshotId: "page-009:0", toSnapshotId: "page-009:1" },
      store
    );

    const diffResult = result as DiffSnapshotsResponse;
    expect(diffResult.summary.addedCount).toBe(diffResult.added.length);
  });

  it("B2-DE-005: summary.removedCount matches removed.length", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(
      relay,
      { fromSnapshotId: "page-010:0", toSnapshotId: "page-010:1" },
      store
    );

    const diffResult = result as DiffSnapshotsResponse;
    expect(diffResult.summary.removedCount).toBe(diffResult.removed.length);
  });

  it("B2-DE-005: summary.changedCount matches changed.length", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(
      relay,
      { fromSnapshotId: "page-011:0", toSnapshotId: "page-011:1" },
      store
    );

    const diffResult = result as DiffSnapshotsResponse;
    expect(diffResult.summary.changedCount).toBe(diffResult.changed.length);
  });

  it("B2-DE-005: summary.textDelta is a non-empty string", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(
      relay,
      { fromSnapshotId: "page-012:0", toSnapshotId: "page-012:1" },
      store
    );

    const diffResult = result as DiffSnapshotsResponse;
    expect(diffResult.summary.textDelta).toBeDefined();
    expect(typeof diffResult.summary.textDelta).toBe("string");
    expect(diffResult.summary.textDelta.length).toBeGreaterThan(0);
  });
});

// ── Error handling: browser-not-connected ────────────────────────────────────

describe("browser-not-connected: relay disconnection handling", () => {
  it("returns { success: false, error: 'browser-not-connected' } when relay is disconnected", async () => {
    const relay = {
      request: vi.fn(),
      isConnected: vi.fn(() => false),
    } as unknown as BrowserRelayLike;
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(relay, { fromSnapshotId: "page-013:0" }, store);

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    expect(error.error).toBe("browser-not-connected");
  });
});

// ── DiffToolError type verification ───────────────────────────────────────────

describe("DiffToolError: structured error response types", () => {
  it("DiffToolError allows error: 'snapshot-not-found'", () => {
    const error: DiffToolError = { success: false, error: "snapshot-not-found" };
    expect(error.success).toBe(false);
    expect(error.error).toBe("snapshot-not-found");
  });

  it("DiffToolError allows error: 'snapshot-stale'", () => {
    const error: DiffToolError = { success: false, error: "snapshot-stale" };
    expect(error.success).toBe(false);
    expect(error.error).toBe("snapshot-stale");
  });

  it("DiffToolError allows error: 'browser-not-connected'", () => {
    const error: DiffToolError = { success: false, error: "browser-not-connected" };
    expect(error.success).toBe(false);
    expect(error.error).toBe("browser-not-connected");
  });

  it("DiffToolError allows error: 'timeout'", () => {
    const error: DiffToolError = { success: false, error: "timeout" };
    expect(error.success).toBe(false);
    expect(error.error).toBe("timeout");
  });

  it("DiffToolError allows error: 'action-failed'", () => {
    const error: DiffToolError = { success: false, error: "action-failed" };
    expect(error.success).toBe(false);
    expect(error.error).toBe("action-failed");
  });
});
