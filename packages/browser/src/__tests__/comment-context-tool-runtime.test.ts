import { describe, expect, it, vi } from "vitest";
import { buildCommentContextTool } from "../comment-context-tool.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { BrowserAuditLog } from "../security/audit-log.js";
import type { BrowserBridgeAPI, BrowserRelayLike } from "../types.js";

function createDeps(): { bridge: BrowserBridgeAPI; relay: BrowserRelayLike } {
  const bridge: BrowserBridgeAPI = {
    registerTools: vi.fn(() => ({ dispose: vi.fn() })),
    publishState: vi.fn(),
    invokeTool: vi.fn(async () => ({ success: true, thread: { id: "t-1", comments: [{ id: "c-1", body: "comment", context: { surfaceMetadata: { anchorKey: "id:from-comment", snapshotId: "page-1:2" } } }] } })),
  };
  const relay: BrowserRelayLike = {
    request: vi.fn(async (action, payload) => ({
      success: true,
      requestId: `req-${action}`,
      data: action === "inspect_element"
        ? { found: true, pageId: "page-1", frameId: "main", snapshotId: "page-1:10", capturedAt: "2026-01-01T00:00:00Z", viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }, source: "dom", anchorKey: payload.anchorKey, anchorStrategy: "id", anchorConfidence: "high", resolvedTier: 1 }
        : { found: true, pageId: "page-1", frameId: "main", snapshotId: "page-1:11", capturedAt: "2026-01-01T00:00:01Z", viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }, source: "dom", html: "<div></div>", text: "", nodeCount: 1, truncated: false },
    })),
    push: vi.fn(),
    isConnected: vi.fn(() => true),
  };
  return { bridge, relay };
}

describe("comment-context tool runtime", () => {
  it("maps structured comment_get failures to comment-get-failed", async () => {
    const { bridge, relay } = createDeps();
    ;(bridge.invokeTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: false, error: "bridge-down", message: "Bridge unavailable" });
    const tool = buildCommentContextTool(bridge, relay, new SnapshotRetentionStore(), {
      originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
      redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
      auditLog: new BrowserAuditLog(),
      snapshotRetention: { maxAgeMs: 0 },
    });

    const result = await tool.handler({ threadId: "t-err" });
    expect(result).toEqual({ success: false, error: "comment-get-failed", threadId: "t-err", message: "Bridge unavailable" });
  });

  it("returns top-level context-resolution-failed when nested inspect/excerpt fail", async () => {
    const { bridge, relay } = createDeps();
    ;(relay.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true, requestId: "req-inspect", data: { error: "browser-not-connected" } });
    const tool = buildCommentContextTool(bridge, relay, new SnapshotRetentionStore(), {
      originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
      redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
      auditLog: new BrowserAuditLog(),
      snapshotRetention: { maxAgeMs: 0 },
    });

    const result = await tool.handler({ threadId: "t-1" });
    expect(result).toEqual(expect.objectContaining({ success: false, error: "context-resolution-failed", threadId: "t-1" }));
  });

  it("returns top-level context-resolution-failed when stale anchor cannot be re-resolved", async () => {
    const { bridge, relay } = createDeps();
    ;(relay.request as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      requestId: "req-found-false",
      data: {
        found: false,
        pageId: "page-1",
        frameId: "main",
        snapshotId: "page-1:10",
        capturedAt: "2026-01-01T00:00:00Z",
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
        source: "dom",
      },
    });
    const tool = buildCommentContextTool(bridge, relay, new SnapshotRetentionStore(), {
      originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
      redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
      auditLog: new BrowserAuditLog(),
      snapshotRetention: { maxAgeMs: 0 },
    });

    const result = await tool.handler({ threadId: "t-1" });
    expect(result).toEqual(expect.objectContaining({ success: false, error: "context-resolution-failed", threadId: "t-1" }));
  });

  it("returns context-mismatch when rerun context does not match stored anchor metadata", async () => {
    const { bridge, relay } = createDeps();
    ;(bridge.invokeTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      thread: {
        id: "t-mismatch",
        comments: [{ id: "c-mismatch", body: "comment", context: { surfaceMetadata: { anchorKey: "id:from-comment", tagName: "button", textSnippet: "Expected text" } } }],
      },
    });
    ;(relay.request as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      requestId: "req-success",
      data: {
        found: true,
        pageId: "page-1",
        frameId: "main",
        snapshotId: "page-1:10",
        capturedAt: "2026-01-01T00:00:00Z",
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
        source: "dom",
        element: { tag: "div", textContent: "Different text" },
        text: "Different text",
        html: "<div>Different text</div>",
        nodeCount: 1,
        truncated: false,
      },
    });
    const tool = buildCommentContextTool(bridge, relay, new SnapshotRetentionStore(), {
      originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
      redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
      auditLog: new BrowserAuditLog(),
      snapshotRetention: { maxAgeMs: 0 },
    });

    const result = await tool.handler({ threadId: "t-mismatch" });
    expect(result).toEqual(expect.objectContaining({ success: false, error: "context-mismatch", threadId: "t-mismatch" }));
  });

  it("retries nested same-origin iframe paths when stored frameId is stale", async () => {
    const { bridge, relay } = createDeps();
    ;(bridge.invokeTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      thread: {
        id: "t-nested",
        comments: [{ id: "c-nested", body: "comment", context: { surfaceMetadata: { anchorKey: "id:from-comment", snapshotId: "page-1:2", frameId: "stale/frame" } } }],
      },
    });
    ;(relay.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ success: true, requestId: "req-inspect-stale", data: { error: "action-failed" } })
      .mockResolvedValueOnce({ success: true, requestId: "req-excerpt-stale", data: { error: "action-failed" } })
      .mockResolvedValueOnce({ success: true, requestId: "req-page-map-current", data: { pageUrl: "https://example.com", pageId: "page-1", frameId: "main", snapshotId: "page-1:5", capturedAt: "2026-01-01T00:00:00Z", viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }, source: "dom", title: "Test", nodes: [], totalElements: 0, truncated: false, iframes: [{ frameId: "outer", sameOrigin: true, iframes: [{ frameId: "outer/inner", sameOrigin: true }] }] } })
      .mockResolvedValueOnce({ success: true, requestId: "req-page-map-retry", data: { pageUrl: "https://example.com", pageId: "page-1", frameId: "main", snapshotId: "page-1:5", capturedAt: "2026-01-01T00:00:00Z", viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }, source: "dom", title: "Test", nodes: [], totalElements: 0, truncated: false, iframes: [{ frameId: "outer", sameOrigin: true, iframes: [{ frameId: "outer/inner", sameOrigin: true }] }] } })
      .mockResolvedValueOnce({ success: true, requestId: "req-inspect-retry", data: { found: true, pageId: "page-1", frameId: "outer/inner", snapshotId: "page-1:6", capturedAt: "2026-01-01T00:00:01Z", viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }, source: "dom", anchorKey: "id:from-comment", anchorStrategy: "id", anchorConfidence: "high", resolvedTier: 1 } })
      .mockResolvedValueOnce({ success: true, requestId: "req-excerpt-retry", data: { found: true, pageId: "page-1", frameId: "outer/inner", snapshotId: "page-1:7", capturedAt: "2026-01-01T00:00:02Z", viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }, source: "dom", html: "<div></div>", text: "", nodeCount: 1, truncated: false } });
    const tool = buildCommentContextTool(bridge, relay, new SnapshotRetentionStore(), {
      originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
      redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
      auditLog: new BrowserAuditLog(),
      snapshotRetention: { maxAgeMs: 0 },
    });

    const result = await tool.handler({ threadId: "t-nested" });
    expect(result).toEqual(expect.objectContaining({ success: true, inspect: expect.objectContaining({ frameId: "outer/inner" }) }));
  });

  it("retries to main when a stale stored iframe id now resolves in the top document", async () => {
    const { bridge, relay } = createDeps();
    ;(bridge.invokeTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      thread: {
        id: "t-main-retry",
        anchor: { kind: "surface", surfaceType: "browser", uri: "https://example.com/page" },
        comments: [{ id: "c-main-retry", body: "comment", context: { surfaceMetadata: { anchorKey: "id:from-comment", frameId: "stale/frame", snapshotId: "page-1:2" } } }],
      },
    });
    ;(relay.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ success: true, requestId: "req-inspect-stale", data: { error: "action-failed" } })
      .mockResolvedValueOnce({ success: true, requestId: "req-excerpt-stale", data: { error: "action-failed" } })
      .mockResolvedValueOnce({ success: true, requestId: "req-page-map-current", data: { pageUrl: "https://example.com/page", pageId: "page-1", frameId: "main", snapshotId: "page-1:5", capturedAt: "2026-01-01T00:00:00Z", viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }, source: "dom", title: "Test", nodes: [], totalElements: 0, truncated: false, iframes: [] } })
      .mockResolvedValueOnce({ success: true, requestId: "req-page-map-retry", data: { pageUrl: "https://example.com/page", pageId: "page-1", frameId: "main", snapshotId: "page-1:5", capturedAt: "2026-01-01T00:00:00Z", viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }, source: "dom", title: "Test", nodes: [], totalElements: 0, truncated: false, iframes: [] } })
      .mockResolvedValueOnce({ success: true, requestId: "req-inspect-main", data: { found: true, pageId: "page-1", frameId: "main", snapshotId: "page-1:6", capturedAt: "2026-01-01T00:00:01Z", viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }, source: "dom", anchorKey: "id:from-comment", anchorStrategy: "id", anchorConfidence: "high", resolvedTier: 1 } })
      .mockResolvedValueOnce({ success: true, requestId: "req-excerpt-main", data: { found: true, pageId: "page-1", frameId: "main", snapshotId: "page-1:7", capturedAt: "2026-01-01T00:00:02Z", viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }, source: "dom", html: "<div></div>", text: "", nodeCount: 1, truncated: false } });
    const tool = buildCommentContextTool(bridge, relay, new SnapshotRetentionStore(), {
      originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
      redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
      auditLog: new BrowserAuditLog(),
      snapshotRetention: { maxAgeMs: 0 },
    });

    const result = await tool.handler({ threadId: "t-main-retry" });
    expect(result).toEqual(expect.objectContaining({ success: true, resolvedFrameId: "main" }));
  });

  it("fails with context-mismatch on the wrong active tab even when an element matches", async () => {
    const { bridge, relay } = createDeps();
    ;(bridge.invokeTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      thread: {
        id: "t-wrong-tab",
        anchor: { kind: "surface", surfaceType: "browser", uri: "https://stored.example/page" },
        comments: [{ id: "c-wrong-tab", body: "comment", context: { surfaceMetadata: { anchorKey: "id:from-comment" } } }],
      },
    });
    ;(relay.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ success: true, requestId: "req-inspect", data: { found: true, pageId: "page-1", frameId: "main", snapshotId: "page-1:10", capturedAt: "2026-01-01T00:00:00Z", viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }, source: "dom", anchorKey: "id:from-comment", anchorStrategy: "id", anchorConfidence: "high", resolvedTier: 1 } })
      .mockResolvedValueOnce({ success: true, requestId: "req-excerpt", data: { found: true, pageId: "page-1", frameId: "main", snapshotId: "page-1:11", capturedAt: "2026-01-01T00:00:01Z", viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }, source: "dom", html: "<div></div>", text: "", nodeCount: 1, truncated: false } })
      .mockResolvedValueOnce({ success: true, requestId: "req-page-map", data: { pageUrl: "https://active.example/page", pageId: "page-1", frameId: "main", snapshotId: "page-1:5", capturedAt: "2026-01-01T00:00:00Z", viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }, source: "dom", title: "Wrong tab", nodes: [], totalElements: 0, truncated: false } });
    const tool = buildCommentContextTool(bridge, relay, new SnapshotRetentionStore(), {
      originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
      redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
      auditLog: new BrowserAuditLog(),
      snapshotRetention: { maxAgeMs: 0 },
    });

    const result = await tool.handler({ threadId: "t-wrong-tab" });
    expect(result).toEqual(expect.objectContaining({ success: false, error: "context-mismatch", threadId: "t-wrong-tab" }));
  });
});
