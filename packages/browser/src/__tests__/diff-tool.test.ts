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
 * The strict mock (createStrictRelay) returns an error when `diff_snapshots`
 * receives an undefined ID, while still allowing `get_page_map` to succeed.
 * That keeps the harness representative for implicit-resolution flows.
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
      if (overrides?.errorAction === "timeout") {
        return {
          success: false,
          requestId: "test",
          error: "timeout",
        };
      }
      if (overrides?.errorAction === "browser-not-connected") {
        return {
          success: false,
          requestId: "test",
          error: "browser-not-connected",
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
    request: vi.fn().mockImplementation(async (action: string, payload?: Record<string, unknown>) => {
      if (action === "get_page_map") {
        return {
          success: true,
          requestId: "test",
          data: makeEnvelope("page-strict", 1),
        };
      }

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
    expect(tools[0]!.name).toBe("accordo_browser_diff_snapshots");
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
    * B2-DE-003 strict-path: a strict relay should succeed once the handler has
    * resolved the implicit `toSnapshotId` before calling `diff_snapshots`.
    */
  it("B2-DE-003 strict mock: succeeds after resolving implicit toSnapshotId", async () => {
    const strictRelay = createStrictRelay();
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(strictRelay, { fromSnapshotId: "page-strict:0" }, store);

    expect(result).not.toHaveProperty("success", false);
    const diffResult = result as DiffSnapshotsResponse;

    expect(diffResult.fromSnapshotId).toBe("page-strict:0");
    expect(diffResult.toSnapshotId).toBe("page-strict:1");
  });

  it("treats blank toSnapshotId as omitted and resolves a fresh snapshot", async () => {
    const relay = createRecordingRelay();
    const store = new SnapshotRetentionStore();

    await handleDiffSnapshots(relay, { fromSnapshotId: "page-blank:0", toSnapshotId: "   " }, store);

    const payload = (relay as ReturnType<typeof createRecordingRelay>).getRecordedPayload();
    expect(typeof payload.toSnapshotId).toBe("string");
    expect((payload.toSnapshotId as string).length).toBeGreaterThan(0);
    expect(payload.toSnapshotId).not.toBe("   ");
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
    */
  it("B2-DE-004 RED: handler calls relay with resolved fromSnapshotId (not undefined) when omitted", async () => {
    const relay = createRecordingRelay();
    const store = new SnapshotRetentionStore();

    // Call with only toSnapshotId — fromSnapshotId is undefined
    await handleDiffSnapshots(relay, { toSnapshotId: "page-003:5" }, store);

    // RECORDING RELAY ASSERTION: The handler must have called relay with
    // an explicitly resolved fromSnapshotId, not undefined.
    const payload = (relay as ReturnType<typeof createRecordingRelay>).getRecordedPayload();
    expect(payload.fromSnapshotId).not.toBeUndefined();
    expect(typeof payload.fromSnapshotId).toBe("string");
    expect((payload.fromSnapshotId as string).length).toBeGreaterThan(0);
  });

  /**
    * B2-DE-004 RED: When fromSnapshotId is omitted, the resolved fromSnapshotId
    * must be semantically older than toSnapshotId (version ordering).
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
    * B2-DE-004 strict-path: a strict relay should succeed once the handler has
    * resolved the implicit `fromSnapshotId` before calling `diff_snapshots`.
    */
  it("B2-DE-004 strict mock: succeeds after resolving implicit fromSnapshotId", async () => {
    const strictRelay = createStrictRelay();
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(strictRelay, { toSnapshotId: "page-strict:5" }, store);

    expect(result).not.toHaveProperty("success", false);
    const diffResult = result as DiffSnapshotsResponse;

    expect(diffResult.fromSnapshotId).toBe("page-strict:4");
    expect(diffResult.toSnapshotId).toBe("page-strict:5");
  });

  it("treats blank fromSnapshotId as omitted and resolves the previous snapshot", async () => {
    const relay = createRecordingRelay();
    const store = new SnapshotRetentionStore();

    await handleDiffSnapshots(relay, { fromSnapshotId: "", toSnapshotId: "page-blank:3" }, store);

    const payload = (relay as ReturnType<typeof createRecordingRelay>).getRecordedPayload();
    expect(payload.fromSnapshotId).toBe("page-blank:2");
  });
});

// ── B2-DE-006: Diff error for missing snapshot ─────────────────────────────────

describe("B2-DE-006: snapshot-not-found error for missing snapshots", () => {
  it("B2-DE-006: snapshot-not-found for unknown snapshot without eviction hint (store is empty)", async () => {
    const relay = createMockRelay({ errorAction: "snapshot-not-found" });
    const store = new SnapshotRetentionStore(); // empty — no eviction analysis possible

    const result = await handleDiffSnapshots(relay, { fromSnapshotId: "unknown:99", toSnapshotId: "unknown:100" }, store);

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    expect(error.error).toBe("snapshot-not-found");
    expect(error.details).toBeDefined();
    // No eviction hint because the store has no snapshots for this pageId
    expect(error.details!.eviction).toBeUndefined();
    expect(error.details!.reason).toBeDefined();
  });

  it("B2-DE-006: snapshot-not-found error for pruned snapshot — includes eviction hint when store is at capacity", async () => {
    const relay = createMockRelay({ errorAction: "snapshot-not-found" });
    const store = new SnapshotRetentionStore();

    // Pre-populate the store with RETENTION_SLOTS snapshots so it is at capacity
    for (let i = 0; i < 10; i++) {
      store.save("page-005", {
        pageId: "page-005",
        frameId: "main",
        snapshotId: `page-005:${i}`,
        capturedAt: new Date().toISOString(),
        viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
        source: "dom",
      });
    }

    // Request a fromSnapshotId older than any retained version. The handler
    // should analyze the missing older ID, not the valid newer one.
    const result = await handleDiffSnapshots(relay, { fromSnapshotId: "page-005:-1", toSnapshotId: "page-005:9" }, store);

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    expect(error.error).toBe("snapshot-not-found");
    expect(error.details).toBeDefined();
    expect(error.details!.eviction).toBeDefined();
    expect(error.details!.eviction!.wasEvicted).toBe(true);
    expect(error.details!.eviction!.requestedSnapshotId).toBe("page-005:-1");
    expect(error.details!.eviction!.retentionWindow).toBe(10);
    expect(typeof error.details!.eviction!.suggestedAction).toBe("string");
    expect(error.details!.reason).toContain("evicted");
  });

  it("B2-DE-006: snapshot-not-found — no eviction hint when store is below capacity (never-existed scenario)", async () => {
    const relay = createMockRelay({ errorAction: "snapshot-not-found" });
    const store = new SnapshotRetentionStore();

    // Store has only 3 snapshots — below capacity — so the missing version was
    // never retained and should not be reported as evicted.
    for (let i = 0; i < 3; i++) {
      store.save("page-006", {
        pageId: "page-006",
        frameId: "main",
        snapshotId: `page-006:${i}`,
        capturedAt: new Date().toISOString(),
        viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
        source: "dom",
      });
    }

    const result = await handleDiffSnapshots(relay, { fromSnapshotId: "page-006:-1", toSnapshotId: "page-006:2" }, store);

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    expect(error.error).toBe("snapshot-not-found");
    expect(error.details).toBeDefined();
    // wasEvicted is false because store is below capacity (never hit eviction)
    expect(error.details!.eviction!.wasEvicted).toBe(false);
    expect(error.details!.reason).toBeDefined();
  });

  it("B2-DE-006: snapshot-not-found error has recoveryHints at top level (not only nested in details)", async () => {
    const relay = createMockRelay({ errorAction: "snapshot-not-found" });
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(relay, { fromSnapshotId: "unknown:99", toSnapshotId: "unknown:100" }, store);

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    expect(error.error).toBe("snapshot-not-found");
    // recoveryHints must appear at top level so agents can access it without drilling into details
    expect(typeof error.recoveryHints).toBe("string");
    expect((error.recoveryHints as string).length).toBeGreaterThan(0);
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

  it("B2-DE-007: snapshot-stale response includes details.reason and details.recoveryHints", async () => {
    const relay = createMockRelay({ errorAction: "snapshot-stale" });
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(relay, { fromSnapshotId: "page-006:0", toSnapshotId: "page-006:1" }, store);

    const error = result as DiffToolError;
    expect(error.error).toBe("snapshot-stale");
    expect(error.retryable).toBe(false);
    expect(error.details).toBeDefined();
    expect(typeof error.details?.reason).toBe("string");
    expect(error.details?.reason.length).toBeGreaterThan(0);
    expect(typeof error.details?.recoveryHints).toBe("string");
    expect(error.details?.recoveryHints?.length).toBeGreaterThan(0);
  });

  it("B2-DE-007: snapshot-stale error has recoveryHints at top level (not only nested in details)", async () => {
    const relay = createMockRelay({ errorAction: "snapshot-stale" });
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(relay, { fromSnapshotId: "page-006:0", toSnapshotId: "page-006:1" }, store);

    const error = result as DiffToolError;
    expect(error.error).toBe("snapshot-stale");
    // recoveryHints must appear at top level so agents can access it without drilling into details
    expect(typeof error.recoveryHints).toBe("string");
    expect((error.recoveryHints as string).length).toBeGreaterThan(0);
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
  it("returns retry guidance when relay is disconnected", async () => {
    const relay = {
      request: vi.fn(),
      isConnected: vi.fn(() => false),
    } as unknown as BrowserRelayLike;
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(relay, { fromSnapshotId: "page-013:0" }, store);

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    expect(error.error).toBe("browser-not-connected");
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(2000);
  });

  it("preserves retry guidance when relay returns browser-not-connected", async () => {
    const relay = createMockRelay({ errorAction: "browser-not-connected" });
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(relay, { fromSnapshotId: "page-014:0", toSnapshotId: "page-014:1" }, store);

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    expect(error.error).toBe("browser-not-connected");
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(2000);
  });

  it("preserves retry guidance when relay returns timeout", async () => {
    const relay = createMockRelay({ errorAction: "timeout" });
    const store = new SnapshotRetentionStore();

    const result = await handleDiffSnapshots(relay, { fromSnapshotId: "page-015:0", toSnapshotId: "page-015:1" }, store);

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    expect(error.error).toBe("timeout");
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(1000);
  });
});

// ── DiffToolError type verification ───────────────────────────────────────────

describe("DiffToolError: structured error response types", () => {
  it("DiffToolError allows error: 'snapshot-not-found' with retryable: false", () => {
    const error: DiffToolError = { success: false, error: "snapshot-not-found", retryable: false };
    expect(error.success).toBe(false);
    expect(error.error).toBe("snapshot-not-found");
    expect(error.retryable).toBe(false);
  });

  it("DiffToolError allows error: 'snapshot-stale' with retryable: false", () => {
    const error: DiffToolError = { success: false, error: "snapshot-stale", retryable: false };
    expect(error.success).toBe(false);
    expect(error.error).toBe("snapshot-stale");
    expect(error.retryable).toBe(false);
  });

  it("DiffToolError allows error: 'browser-not-connected' with retryable: true", () => {
    const error: DiffToolError = { success: false, error: "browser-not-connected", retryable: true };
    expect(error.success).toBe(false);
    expect(error.error).toBe("browser-not-connected");
    expect(error.retryable).toBe(true);
  });

  it("DiffToolError allows error: 'timeout' with retryable: true", () => {
    const error: DiffToolError = { success: false, error: "timeout", retryable: true };
    expect(error.success).toBe(false);
    expect(error.error).toBe("timeout");
    expect(error.retryable).toBe(true);
  });

  it("DiffToolError allows error: 'action-failed' with retryable: false", () => {
    const error: DiffToolError = { success: false, error: "action-failed", retryable: false };
    expect(error.success).toBe(false);
    expect(error.error).toBe("action-failed");
    expect(error.retryable).toBe(false);
  });
});

// ── GAP-G2: Pre-flight local store validation (diff ergonomics) ────────────────

describe("GAP-G2: pre-flight store validation for explicit snapshot IDs", () => {
  it("returns snapshot-not-found with availableSnapshotIds when fromSnapshotId is explicit but stale", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();

    // Populate the store with some snapshots for the page (simulating prior captures)
    store.save("page-g2", makeEnvelope("page-g2", 5));
    store.save("page-g2", makeEnvelope("page-g2", 6));
    store.save("page-g2", makeEnvelope("page-g2", 7));

    // Agent tries to use a stale fromSnapshotId that was evicted
    const result = await handleDiffSnapshots(
      relay,
      { fromSnapshotId: "page-g2:1", toSnapshotId: "page-g2:7" },
      store
    );

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    expect(error.error).toBe("snapshot-not-found");
    expect(error.retryable).toBe(false);
    expect(error.details?.availableSnapshotIds).toBeDefined();
    expect(error.details?.availableSnapshotIds).toContain("page-g2:5");
    expect(error.details?.availableSnapshotIds).toContain("page-g2:6");
    expect(error.details?.availableSnapshotIds).toContain("page-g2:7");
    // relay was NOT called (pre-flight short-circuits)
    expect(relay.request).not.toHaveBeenCalled();
  });

  it("returns snapshot-not-found with availableSnapshotIds when toSnapshotId is explicit but stale", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();

    store.save("page-g2b", makeEnvelope("page-g2b", 3));
    store.save("page-g2b", makeEnvelope("page-g2b", 4));

    const result = await handleDiffSnapshots(
      relay,
      { fromSnapshotId: "page-g2b:3", toSnapshotId: "page-g2b:0" },
      store
    );

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    // fromSnapshotId IS in store, so we pass that pre-flight; toSnapshotId:0 is NOT
    expect(error.error).toBe("snapshot-not-found");
    expect(error.details?.availableSnapshotIds).toBeDefined();
    expect(error.details?.availableSnapshotIds).toContain("page-g2b:3");
    expect(error.details?.availableSnapshotIds).toContain("page-g2b:4");
  });

  it("includes availableSnapshotIds in recoveryHints string", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();

    store.save("page-g2c", makeEnvelope("page-g2c", 10));
    store.save("page-g2c", makeEnvelope("page-g2c", 11));

    const result = await handleDiffSnapshots(
      relay,
      { fromSnapshotId: "page-g2c:2", toSnapshotId: "page-g2c:11" },
      store
    );

    const error = result as DiffToolError;
    expect(error.error).toBe("snapshot-not-found");
    // recoveryHints should contain the available IDs
    expect(error.recoveryHints).toContain("page-g2c:10");
    expect(error.recoveryHints).toContain("page-g2c:11");
  });

  it("does NOT trigger pre-flight when store has no snapshots for the page (empty session)", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    // Store is completely empty — relay should still be called

    const result = await handleDiffSnapshots(
      relay,
      { fromSnapshotId: "page-fresh:0", toSnapshotId: "page-fresh:1" },
      store
    );

    // With empty store, pre-flight is skipped and relay is called → relay returns success
    expect(relay.request).toHaveBeenCalledWith(
      "diff_snapshots",
      expect.objectContaining({ fromSnapshotId: "page-fresh:0", toSnapshotId: "page-fresh:1" }),
      expect.any(Number)
    );
    const diffResult = result as DiffSnapshotsResponse;
    expect(diffResult.fromSnapshotId).toBe("page-fresh:0");
  });

  it("relay-level snapshot-not-found includes availableSnapshotIds from store", async () => {
    // When pre-flight doesn't catch it (IDs in store), but relay still returns snapshot-not-found,
    // the relay-level handler also includes availableSnapshotIds.
    const relay = createMockRelay({ errorAction: "snapshot-not-found" });
    const store = new SnapshotRetentionStore();

    // Populate store — both IDs ARE in the store so pre-flight passes
    store.save("page-g2d", makeEnvelope("page-g2d", 5));
    store.save("page-g2d", makeEnvelope("page-g2d", 6));

    const result = await handleDiffSnapshots(
      relay,
      { fromSnapshotId: "page-g2d:5", toSnapshotId: "page-g2d:6" },
      store
    );

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    expect(error.error).toBe("snapshot-not-found");
    expect(error.details?.reason).toBeDefined();
    // Both IDs are present in the store → relay-level handler can list available IDs
    expect(error.details?.availableSnapshotIds).toEqual(
      expect.arrayContaining(["page-g2d:5", "page-g2d:6"]),
    );
  });
});
