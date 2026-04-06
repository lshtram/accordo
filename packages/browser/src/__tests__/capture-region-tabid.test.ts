/**
 * capture-region-tabid.test.ts
 *
 * Tests for B2-CTX-001/B2-CTX-002 — tabId routing in capture_region tool.
 * Also covers G6 file-ref transport (ADR-2).
 *
 * Tests the Hub handler (handleCaptureRegion in page-tool-handlers-impl.ts)
 * passes tabId through to the relay.request("capture_region", payload) call.
 *
 * API checklist (handleCaptureRegion):
 * - handleCaptureRegion → B2-CTX-001 (tabId pass-through)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BUG BEING TESTED:
 *
 * CaptureRegionArgs has tabId?: number (Phase A stub ✅).
 * handleCaptureRegion passes args as Record<string, unknown> to relay.request,
 * so tabId flows through IF CaptureRegionArgs includes it.
 *
 * But the design doc says:
 * - "Hub Passes: ✅ transparent pass-through" — meaning the handler already
 *   passes args through correctly (args as Record<string,unknown>).
 * - The real bugs are on the extension side (toCapturePayload ignores tabId,
 *   resolvePaddedBounds ignores tabId, etc.).
 *
 * These tests verify the Hub-side pass-through is correct. They document
 * the expected contract: tabId flows through to the relay payload.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleCaptureRegion } from "../page-tool-handlers-impl.js";
import type { CaptureRegionArgs } from "../page-tool-types.js";
import type { BrowserRelayLike } from "../types.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { BrowserAuditLog } from "../security/audit-log.js";

// ── Recording Relay ────────────────────────────────────────────────────────────

/**
 * Recording relay — captures the exact payload passed to relay.request().
 * Use to verify the handler passes tabId through to the relay.
 */
function createRecordingRelay() {
  let recordedPayload: Record<string, unknown> = {};

  const relay = {
    request: vi.fn().mockImplementation(async (_action: string, payload?: Record<string, unknown>) => {
      recordedPayload = { ...(payload ?? {}) };
      return {
        success: true,
        requestId: "test",
        data: {
          success: true,
          dataUrl: "data:image/jpeg;base64,mock",
          width: 100,
          height: 100,
          sizeBytes: 1000,
          anchorSource: "rect",
          pageId: "page",
          frameId: "main",
          snapshotId: "page:0",
          capturedAt: "2025-01-01T00:00:00.000Z",
          viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          source: "dom" as const,
        },
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

function createSecurityFixture() {
  return {
    originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" as const },
    redactionPolicy: { redactPatterns: [] },
    auditLog: new BrowserAuditLog(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("B2-CTX-001: capture_region tabId hub-side pass-through", () => {
  let relay: ReturnType<typeof createRecordingRelay>;
  let store: SnapshotRetentionStore;

  beforeEach(() => {
    relay = createRecordingRelay();
    relay.resetRecordedPayload();
    store = new SnapshotRetentionStore();
  });

  /**
   * B2-CTX-001: When tabId is provided in args, relay.request receives tabId
   * in the payload.
   *
   * Expected: tabId IS included (transparent pass-through).
   * This test verifies the pass-through contract.
   */
  it("B2-CTX-001: handleCaptureRegion passes tabId through to relay.request when provided", async () => {
    const args: CaptureRegionArgs = { tabId: 42, anchorKey: "btn_1" };

    await handleCaptureRegion(relay, args, store);

    const payload = relay.getRecordedPayload();
    expect(payload).toHaveProperty("tabId");
    expect(payload.tabId).toBe(42);
  });

  /**
   * B2-CTX-001: When tabId is absent, relay.request does NOT include tabId
   * in the payload (backward compatibility — active tab is used).
   *
   * Expected: tabId is absent from payload (backward-compatible omission).
   * This test verifies backward-compatible behavior.
   */
  it("B2-CTX-001: handleCaptureRegion omits tabId from relay payload when absent", async () => {
    const args: CaptureRegionArgs = { anchorKey: "btn_2" };

    await handleCaptureRegion(relay, args, store);

    const payload = relay.getRecordedPayload();
    expect(payload).not.toHaveProperty("tabId");
  });

  /**
   * B2-CTX-002: When tabId targets a non-active tab (e.g. tabId: 99),
   * relay.request includes the correct tabId value.
   *
   * This is the key regression test: the agent specifies tabId: 99 to
   * capture a background tab, and the relay must forward that tabId so the
   * extension can route to the correct tab.
   */
  it("B2-CTX-002: handleCaptureRegion passes correct tabId for non-active tab targeting", async () => {
    const args: CaptureRegionArgs = { tabId: 99, rect: { x: 0, y: 0, width: 100, height: 100 } };

    await handleCaptureRegion(relay, args, store);

    const payload = relay.getRecordedPayload();
    expect(payload.tabId).toBe(99);
  });
});

// ── P4-CR: Full-page screenshot mode ───────────────────────────────────────

describe("P4-CR: capture_region mode parameter", () => {
  let relay: ReturnType<typeof createRecordingRelay>;
  let store: SnapshotRetentionStore;

  beforeEach(() => {
    relay = createRecordingRelay();
    relay.resetRecordedPayload();
    store = new SnapshotRetentionStore();
  });

  /**
   * P4-CR: Default mode is region — mode field is absent from payload
   * when not specified (backward compatibility).
   */
  it("P4-CR: handleCaptureRegion omits mode from relay payload when not specified (default: region)", async () => {
    const args: CaptureRegionArgs = { anchorKey: "btn_1" };

    await handleCaptureRegion(relay, args, store);

    const payload = relay.getRecordedPayload();
    expect(payload).not.toHaveProperty("mode");
  });

  /**
   * P4-CR: When mode is "viewport", it is passed through to the relay.
   */
  it("P4-CR: handleCaptureRegion passes mode='viewport' through to relay.request", async () => {
    const args: CaptureRegionArgs = { mode: "viewport", anchorKey: "btn_1" };

    await handleCaptureRegion(relay, args, store);

    const payload = relay.getRecordedPayload();
    expect(payload.mode).toBe("viewport");
  });

  /**
   * P4-CR: When mode is "fullPage", it is passed through to the relay.
   */
  it("P4-CR: handleCaptureRegion passes mode='fullPage' through to relay.request", async () => {
    const args: CaptureRegionArgs = { mode: "fullPage" };

    await handleCaptureRegion(relay, args, store);

    const payload = relay.getRecordedPayload();
    expect(payload.mode).toBe("fullPage");
  });

  /**
   * P4-CR: rect, anchorKey, and nodeRef are still passed through to the relay
   * even when mode is "fullPage" — the extension side ignores them for fullPage.
   * The Hub handler performs transparent pass-through without inspecting mode.
   */
  it("P4-CR: handleCaptureRegion still passes rect/anchorKey/nodeRef through when mode='fullPage'", async () => {
    const args: CaptureRegionArgs = {
      mode: "fullPage",
      tabId: 5,
      anchorKey: "btn_1",
      nodeRef: "ref-42",
      rect: { x: 10, y: 20, width: 300, height: 200 },
    };

    await handleCaptureRegion(relay, args, store);

    const payload = relay.getRecordedPayload();
    expect(payload.tabId).toBe(5);
    expect(payload.anchorKey).toBe("btn_1");
    expect(payload.nodeRef).toBe("ref-42");
    expect(payload.rect).toEqual({ x: 10, y: 20, width: 300, height: 200 });
  });

  /**
   * P4-CR: fullPage mode can be used without any target (no rect, anchorKey, nodeRef).
   */
  it("P4-CR: handleCaptureRegion accepts mode='fullPage' with no target parameters", async () => {
    const args: CaptureRegionArgs = { mode: "fullPage", tabId: 3 };

    await handleCaptureRegion(relay, args, store);

    const payload = relay.getRecordedPayload();
    expect(payload.mode).toBe("fullPage");
    expect(payload.tabId).toBe(3);
    expect(payload).not.toHaveProperty("anchorKey");
    expect(payload).not.toHaveProperty("nodeRef");
    expect(payload).not.toHaveProperty("rect");
  });
});

// ── GAP-E1: PNG/JPEG format support ─────────────────────────────────────────

describe("GAP-E1: capture_region format parameter", () => {
  let relay: ReturnType<typeof createRecordingRelay>;
  let store: SnapshotRetentionStore;

  beforeEach(() => {
    relay = createRecordingRelay();
    relay.resetRecordedPayload();
    store = new SnapshotRetentionStore();
  });

  /**
   * GAP-E1: Default format is absent from payload (backward compatible — relay defaults to jpeg).
   */
  it("GAP-E1: handleCaptureRegion omits format from relay payload when not specified (default: jpeg)", async () => {
    const args: CaptureRegionArgs = { anchorKey: "btn_1" };

    await handleCaptureRegion(relay, args, store);

    const payload = relay.getRecordedPayload();
    expect(payload).not.toHaveProperty("format");
  });

  /**
   * GAP-E1: When format is "jpeg", it is passed through to the relay.
   */
  it("GAP-E1: handleCaptureRegion passes format='jpeg' through to relay.request", async () => {
    const args: CaptureRegionArgs = { anchorKey: "btn_1", format: "jpeg" };

    await handleCaptureRegion(relay, args, store);

    const payload = relay.getRecordedPayload();
    expect(payload.format).toBe("jpeg");
  });

  /**
   * GAP-E1: When format is "png", it is passed through to the relay.
   */
  it("GAP-E1: handleCaptureRegion passes format='png' through to relay.request", async () => {
    const args: CaptureRegionArgs = { anchorKey: "btn_1", format: "png" };

    await handleCaptureRegion(relay, args, store);

    const payload = relay.getRecordedPayload();
    expect(payload.format).toBe("png");
  });

  /**
   * GAP-E1: format works alongside all other parameters (tabId, rect, mode, etc.).
   */
  it("GAP-E1: handleCaptureRegion passes format along with all other parameters", async () => {
    const args: CaptureRegionArgs = {
      tabId: 5,
      anchorKey: "btn_1",
      format: "png",
      mode: "viewport",
      quality: 80,
      padding: 16,
    };

    await handleCaptureRegion(relay, args, store);

    const payload = relay.getRecordedPayload();
    expect(payload.format).toBe("png");
    expect(payload.tabId).toBe(5);
    expect(payload.anchorKey).toBe("btn_1");
    expect(payload.mode).toBe("viewport");
    expect(payload.quality).toBe(80);
    expect(payload.padding).toBe(16);
  });

  /**
   * E4: format="webp" is passed through to the relay (ADR-3).
   */
  it("E4: handleCaptureRegion passes format='webp' through to relay.request", async () => {
    const args: CaptureRegionArgs = { anchorKey: "btn_1", format: "webp" };
    await handleCaptureRegion(relay, args, store);
    const payload = relay.getRecordedPayload();
    expect(payload.format).toBe("webp");
  });
});

// ── GAP-E2: No-target viewport behavior + relatedSnapshotId ─────────────────

describe("GAP-E2: capture_region no-target viewport behavior", () => {
  let relay: ReturnType<typeof createRecordingRelay>;
  let store: SnapshotRetentionStore;

  beforeEach(() => {
    relay = createRecordingRelay();
    relay.resetRecordedPayload();
    store = new SnapshotRetentionStore();
  });

  /**
   * GAP-E2: Viewport mode returns relatedSnapshotId from the most recent DOM snapshot.
   */
  it("GAP-E2: handleCaptureRegion returns relatedSnapshotId from the store after successful capture", async () => {
    // Pre-populate the store with a DOM snapshot
    store.save("page", {
      pageId: "page",
      frameId: "main",
      snapshotId: "page:0",
      capturedAt: "2025-01-01T00:00:00.000Z",
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      source: "dom",
    });

    const args: CaptureRegionArgs = { tabId: 1, mode: "viewport" };

    const result = await handleCaptureRegion(relay, args, store);

    // The result should have relatedSnapshotId from the pre-existing DOM snapshot
    expect(result).toHaveProperty("relatedSnapshotId");
    expect((result as Record<string, unknown>).relatedSnapshotId).toBe("page:0");
  });

  /**
   * GAP-E2: When no previous snapshot exists, relatedSnapshotId is not present.
   */
  it("GAP-E2: handleCaptureRegion omits relatedSnapshotId when no previous snapshot exists", async () => {
    const args: CaptureRegionArgs = { tabId: 1, mode: "viewport" };

    const result = await handleCaptureRegion(relay, args, store);

    // No previous snapshot — relatedSnapshotId should not be set
    expect(result).not.toHaveProperty("relatedSnapshotId");
  });

  it("GAP-E2: omitted mode with no target preserves region semantics and returns no-target", async () => {
    const noTargetRelay = {
      request: vi.fn().mockResolvedValue({
        success: true,
        requestId: "test",
        data: {
          success: false,
          error: "no-target",
          pageId: "page",
          frameId: "main",
          snapshotId: "page:0",
          capturedAt: "2025-01-01T00:00:00.000Z",
          viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          source: "dom" as const,
        },
      }),
      isConnected: vi.fn(() => true),
    } as unknown as BrowserRelayLike;

    const result = await handleCaptureRegion(noTargetRelay, { tabId: 1 }, store);

    expect(result).toHaveProperty("success", false);
    expect((result as Record<string, unknown>).error).toBe("no-target");
  });
});

// ── Feature 5: artifactMode inline for screenshot-producing flows ───────────────

describe("Feature 5: artifactMode: 'inline' on successful screenshot responses", () => {
  let relay: ReturnType<typeof createRecordingRelay>;
  let store: SnapshotRetentionStore;

  beforeEach(() => {
    relay = createRecordingRelay();
    relay.resetRecordedPayload();
    store = new SnapshotRetentionStore();
  });

  /**
   * Feature 5 / MCP checklist §3.1: Successful region capture must include
   * artifactMode: "inline" to advertise that screenshots are returned as
   * inline base64 data URLs (no file-ref or remote-ref yet).
   */
  it("Feature 5: region capture (rect) returns artifactMode: 'inline'", async () => {
    const args: CaptureRegionArgs = { tabId: 1, rect: { x: 0, y: 0, width: 200, height: 100 } };

    const result = await handleCaptureRegion(relay, args, store);

    expect(result).toHaveProperty("success", true);
    expect((result as Record<string, unknown>).artifactMode).toBe("inline");
  });

  /**
   * Feature 5: viewport capture also returns artifactMode: "inline".
   */
  it("Feature 5: viewport capture returns artifactMode: 'inline'", async () => {
    const args: CaptureRegionArgs = { tabId: 1, mode: "viewport" };

    const result = await handleCaptureRegion(relay, args, store);

    expect(result).toHaveProperty("success", true);
    expect((result as Record<string, unknown>).artifactMode).toBe("inline");
  });

  /**
   * Feature 5: full-page capture also returns artifactMode: "inline".
   */
  it("Feature 5: fullPage capture returns artifactMode: 'inline'", async () => {
    const args: CaptureRegionArgs = { tabId: 1, mode: "fullPage" };

    const result = await handleCaptureRegion(relay, args, store);

    expect(result).toHaveProperty("success", true);
    expect((result as Record<string, unknown>).artifactMode).toBe("inline");
  });

  /**
   * Feature 5: Failed captures (e.g. no-target) must NOT include artifactMode,
   * since no binary output was produced. This keeps the contract clean — only
   * successful responses carry artifactMode.
   */
  it("Feature 5: no-target error response does NOT include artifactMode", async () => {
    const noTargetRelay = {
      request: vi.fn().mockResolvedValue({
        success: true,
        requestId: "test",
        data: {
          success: false,
          error: "no-target",
          pageId: "page",
          frameId: "main",
          snapshotId: "page:0",
          capturedAt: "2025-01-01T00:00:00.000Z",
          viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          source: "dom" as const,
        },
      }),
      isConnected: vi.fn(() => true),
    } as unknown as BrowserRelayLike;

    const result = await handleCaptureRegion(noTargetRelay, { tabId: 1 }, store);

    expect(result).toHaveProperty("success", false);
    expect(result as Record<string, unknown>).not.toHaveProperty("artifactMode");
  });

  it("Feature 5: browser-not-connected transport error does NOT include artifactMode", async () => {
    const disconnectedRelay = {
      request: vi.fn().mockResolvedValue({
        success: false,
        requestId: "test",
        error: "browser-not-connected",
      }),
      isConnected: vi.fn(() => false),
    } as unknown as BrowserRelayLike;

    const result = await handleCaptureRegion(disconnectedRelay, { tabId: 1, mode: "viewport" }, store);

    expect(result).toHaveProperty("success", false);
    expect((result as Record<string, unknown>).error).toBe("browser-not-connected");
    expect(result as Record<string, unknown>).not.toHaveProperty("artifactMode");
  });

  it("Feature 5: origin-blocked policy error does NOT include artifactMode", async () => {
    const blockedRelay = {
      request: vi.fn().mockResolvedValue({
        success: true,
        requestId: "test",
        data: {
          success: true,
          dataUrl: "data:image/jpeg;base64,abc",
          width: 100,
          height: 80,
          sizeBytes: 3,
          pageId: "page",
          frameId: "main",
          snapshotId: "page:1",
          capturedAt: "2025-01-01T00:00:00.000Z",
          viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          source: "visual" as const,
          pageUrl: "https://blocked.example/path",
        },
      }),
      isConnected: vi.fn(() => true),
    } as unknown as BrowserRelayLike;

    const localStore = new SnapshotRetentionStore();
    const security = createSecurityFixture();
    security.originPolicy.deniedOrigins = ["https://blocked.example"];

    const result = await handleCaptureRegion(blockedRelay, { tabId: 1, mode: "viewport" }, localStore, security);

    expect(result).toHaveProperty("success", false);
    expect((result as Record<string, unknown>).error).toBe("origin-blocked");
    expect(result as Record<string, unknown>).not.toHaveProperty("artifactMode");
  });
});

// ── G6: file-ref artifact transport (ADR-2) ──────────────────────────────────

describe("G6: capture_region transport='file-ref' artifact transport", () => {
  let relay: ReturnType<typeof createRecordingRelay>;
  let store: SnapshotRetentionStore;
  let tmpDir: string;

  beforeEach(() => {
    relay = createRecordingRelay();
    relay.resetRecordedPayload();
    store = new SnapshotRetentionStore();
    // Create a temp dir and point the handler to it via env var (avoids ESM mock limitations)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "accordo-test-"));
    process.env["ACCORDO_SCREENSHOTS_DIR"] = tmpDir;
  });

  afterEach(() => {
    delete process.env["ACCORDO_SCREENSHOTS_DIR"];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * G6: When transport="file-ref", the response must include fileUri (file:// URI),
   * filePath (absolute OS path), artifactMode="file-ref", and no dataUrl.
   */
  it("G6: transport='file-ref' writes file and returns fileUri + filePath, omits dataUrl", async () => {
    const args: CaptureRegionArgs = { tabId: 1, mode: "viewport", transport: "file-ref" };

    const result = await handleCaptureRegion(relay, args, store) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.artifactMode).toBe("file-ref");
    expect(typeof result.fileUri).toBe("string");
    expect((result.fileUri as string).startsWith("file://")).toBe(true);
    expect(typeof result.filePath).toBe("string");
    expect(result).not.toHaveProperty("dataUrl");
    expect(result).not.toHaveProperty("transportFallback");

    // File must actually exist on disk
    expect(fs.existsSync(result.filePath as string)).toBe(true);
  });

  /**
   * G6: The written file is non-empty and contains valid image data
   * (the base64 payload from the relay).
   */
  it("G6: written screenshot file contains the decoded base64 payload", async () => {
    const args: CaptureRegionArgs = { tabId: 1, mode: "viewport", transport: "file-ref" };

    const result = await handleCaptureRegion(relay, args, store) as Record<string, unknown>;

    const fileContents = fs.readFileSync(result.filePath as string);
    // The mock relay returns "data:image/jpeg;base64,mock" — "mock" base64-decoded is non-empty bytes
    expect(fileContents.length).toBeGreaterThan(0);
  });

  /**
   * G6: When format="png" and transport="file-ref", the filename uses .png extension.
   */
  it("G6: file extension matches the requested format", async () => {
    const args: CaptureRegionArgs = { tabId: 1, mode: "viewport", transport: "file-ref", format: "png" };

    const result = await handleCaptureRegion(relay, args, store) as Record<string, unknown>;

    expect(result.artifactMode).toBe("file-ref");
    expect((result.filePath as string).endsWith(".png")).toBe(true);
  });

  /**
   * G6: Default transport (omitted) still returns inline dataUrl and artifactMode="inline".
   * This is the regression guard — file-ref must not affect default behaviour.
   */
  it("G6: default transport (omitted) still returns inline dataUrl, no filePath", async () => {
    const args: CaptureRegionArgs = { tabId: 1, mode: "viewport" };

    const result = await handleCaptureRegion(relay, args, store) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.artifactMode).toBe("inline");
    expect(typeof result.dataUrl).toBe("string");
    expect(result).not.toHaveProperty("filePath");
    expect(result).not.toHaveProperty("fileUri");
    expect(result).not.toHaveProperty("transportFallback");
  });

  /**
   * G6: When transport="file-ref" but the write fails (unwritable dir),
   * the response falls back to inline transport and sets transportFallback=true.
   */
  it("G6: transport='file-ref' falls back to inline with transportFallback=true on write error", async () => {
    // Create a regular FILE at tmpDir/blocker, then point ACCORDO_SCREENSHOTS_DIR to a
    // path whose parent is that file. mkdirSync(..., {recursive:true}) will throw ENOTDIR
    // because a file component of the path is not a directory — this is reliable on all OSes.
    const blocker = path.join(tmpDir, "blocker");
    fs.writeFileSync(blocker, "x");
    process.env["ACCORDO_SCREENSHOTS_DIR"] = path.join(blocker, "screenshots");

    const args: CaptureRegionArgs = { tabId: 1, mode: "viewport", transport: "file-ref" };

    const result = await handleCaptureRegion(relay, args, store) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.artifactMode).toBe("inline");
    expect(result.transportFallback).toBe(true);
    expect(typeof result.dataUrl).toBe("string");
    expect(result).not.toHaveProperty("filePath");
    expect(result).not.toHaveProperty("fileUri");
  });
});
